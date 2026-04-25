package com.platform.jupiter.files;

import com.platform.jupiter.config.AppProperties;
import io.fabric8.kubernetes.api.model.Pod;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.dsl.ExecListener;
import io.fabric8.kubernetes.client.dsl.ExecWatch;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class WorkspaceExecutionService {
    private static final long PYTHON_TIMEOUT_SECONDS = 20L;
    private static final long GEMINI_TIMEOUT_SECONDS = 180L;
    private static final int MAX_LOGS_PER_USER = 100;
    private static final int MAX_OUTPUT_CHARS = 4000;
    private static final int USER_MAX_PARALLEL_EXECUTIONS = 1;
    private static final int ADMIN_MAX_PARALLEL_EXECUTIONS = 3;
    private static final int USER_CPU_SECONDS = 20;
    private static final int ADMIN_CPU_SECONDS = 60;
    private static final int USER_VMEM_KB = 1_048_576;
    private static final int ADMIN_VMEM_KB = 4_194_304;

    private final AppProperties appProperties;
    private final KubernetesClient kubernetesClient;
    private final FileService fileService;
    private final Map<String, ArrayDeque<WorkspaceExecutionLogDto>> executionLogsByUser = new ConcurrentHashMap<>();
    private final Map<String, Semaphore> executionSemaphoresByUser = new ConcurrentHashMap<>();

    public WorkspaceExecutionService(
            AppProperties appProperties,
            KubernetesClient kubernetesClient,
            FileService fileService) {
        this.appProperties = appProperties;
        this.kubernetesClient = kubernetesClient;
        this.fileService = fileService;
    }

    public WorkspaceRunResponse runPythonFile(
            String relativePath,
            String username,
            boolean admin,
            boolean autoFixOnFailure,
            boolean includeSummary) {
        return withExecutionPermit(username, admin, () -> runPythonFileInternal(relativePath, username, admin, autoFixOnFailure, includeSummary));
    }

    private WorkspaceRunResponse runPythonFileInternal(
            String relativePath,
            String username,
            boolean admin,
            boolean autoFixOnFailure,
            boolean includeSummary) {
        if (relativePath == null || relativePath.isBlank() || !relativePath.endsWith(".py")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only .py files can be executed");
        }
        Path workspaceRoot = fileService.workspaceRootPath(username, admin);
        Path workspaceHome = fileService.workspaceHomePath(username, admin);
        Path file = fileService.resolveWorkspacePath(relativePath, username, admin);
        if (!java.nio.file.Files.exists(file) || java.nio.file.Files.isDirectory(file)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Python file not found");
        }

        String command = buildPythonCommand(file);
        String shellCommand = "cd " + shellQuote(workspaceRoot.toString())
                + " && export HOME=" + shellQuote(workspaceHome.toString())
                + " PATH=\"$PATH:/usr/local/bin:/usr/bin:/opt/jupiter-cli/bin\""
                + " TERM=xterm-256color"
                + " && " + buildResourceLimitCommand(admin)
                + " && " + command;

        PythonExecutionResult firstRun = executeShellCommandWithStreams(shellCommand, PYTHON_TIMEOUT_SECONDS);
        List<String> autoFixNotes = new ArrayList<>();
        boolean autoFixApplied = false;

        addLog(
                username,
                "python",
                relativePath,
                command,
                firstRun.exitCode(),
                firstRun.timedOut(),
                firstRun.stdout(),
                firstRun.stderr());

        PythonExecutionResult finalRun = firstRun;
        if (autoFixOnFailure && shouldAttemptAutoFix(firstRun)) {
            String autoFixPrompt = buildAutoFixPrompt(relativePath, firstRun.stdout(), firstRun.stderr());
            String autoFixCommand = "CI=1 NO_COLOR=1 TERM=dumb /opt/jupiter-cli/bin/gemini -y -p " + shellQuote(autoFixPrompt) + " 2>&1";
            String autoFixShellCommand = "cd " + shellQuote(workspaceRoot.toString())
                    + " && export HOME=" + shellQuote(workspaceHome.toString())
                    + " PATH=\"$PATH:/usr/local/bin:/usr/bin:/opt/jupiter-cli/bin\""
                    + " TERM=xterm-256color"
                    + " && " + buildResourceLimitCommand(admin)
                    + " && " + buildGeminiBootstrap(workspaceHome)
                    + " && " + autoFixCommand;
            ExecutionResult autoFixResult = executeCommand(autoFixShellCommand, GEMINI_TIMEOUT_SECONDS);
            autoFixNotes.add("Gemini auto-fix run exitCode=" + autoFixResult.exitCode() + ", timedOut=" + autoFixResult.timedOut());
            if (!autoFixResult.output().isBlank()) {
                autoFixNotes.add(truncate(autoFixResult.output().trim()));
            }
            addLog(
                    username,
                    "python-autofix",
                    relativePath,
                    autoFixCommand,
                    autoFixResult.exitCode(),
                    autoFixResult.timedOut(),
                    autoFixResult.output(),
                    "");

            if (!autoFixResult.timedOut()) {
                autoFixApplied = true;
                finalRun = executeShellCommandWithStreams(shellCommand, PYTHON_TIMEOUT_SECONDS);
                addLog(
                        username,
                        "python-retry",
                        relativePath,
                        command,
                        finalRun.exitCode(),
                        finalRun.timedOut(),
                        finalRun.stdout(),
                        finalRun.stderr());
            }
        }

        String summary = includeSummary ? buildExecutionSummary(finalRun.stdout(), finalRun.stderr(), finalRun.exitCode(), finalRun.timedOut()) : "";
        return new WorkspaceRunResponse(
                command,
                finalRun.exitCode(),
                finalRun.stdout(),
                finalRun.stderr(),
                finalRun.timedOut(),
                summary,
                autoFixApplied,
                autoFixNotes);
    }

    private PythonExecutionResult executeShellCommandWithStreams(String shellCommand, long timeoutSeconds) {
        Pod pod = resolveCliPod();
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        CountDownLatch done = new CountDownLatch(1);
        ExecWatch watch = null;
        try {
            watch = kubernetesClient.pods()
                    .inNamespace(appProperties.namespace())
                    .withName(pod.getMetadata().getName())
                    .writingOutput(stdout)
                    .writingError(stderr)
                    .usingListener(new ExecListener() {
                        @Override
                        public void onOpen() {
                        }

                        @Override
                        public void onFailure(Throwable t, io.fabric8.kubernetes.client.dsl.ExecListener.Response failureResponse) {
                            done.countDown();
                        }

                        @Override
                        public void onClose(int code, String reason) {
                            done.countDown();
                        }
                    })
                    .exec("sh", "-lc", shellCommand);

            boolean finished = done.await(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                return new PythonExecutionResult(
                        stdout.toString(StandardCharsets.UTF_8),
                        stderr.toString(StandardCharsets.UTF_8),
                        -1,
                        true);
            }
            Integer exitCode = watch.exitCode().getNow(0);
            return new PythonExecutionResult(
                    stdout.toString(StandardCharsets.UTF_8),
                    stderr.toString(StandardCharsets.UTF_8),
                    exitCode == null ? 0 : exitCode,
                    false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Python execution interrupted", e);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unable to execute Python file", e);
        } finally {
            if (watch != null) {
                try {
                    watch.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    public WorkspaceGeminiResponse runGeminiPrompt(WorkspaceGeminiRequest request, String username, boolean admin) {
        return withExecutionPermit(username, admin, () -> runGeminiPromptInternal(request, username, admin));
    }

    private WorkspaceGeminiResponse runGeminiPromptInternal(WorkspaceGeminiRequest request, String username, boolean admin) {
        String prompt = request.prompt() == null ? "" : request.prompt().trim();
        if (prompt.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prompt is required");
        }

        Path workspaceRoot = fileService.workspaceRootPath(username, admin);
        Path workspaceHome = fileService.workspaceHomePath(username, admin);
        Path workingDirectory = resolveWorkingDirectory(request.directoryPath(), request.filePath(), username, admin, workspaceRoot);
        List<String> contextFiles = resolveContextFiles(request.contextFiles(), request.filePath(), username, admin);
        String compiledPrompt = buildPromptWithContext(prompt, contextFiles, username, admin);

        String command = "CI=1 NO_COLOR=1 TERM=dumb /opt/jupiter-cli/bin/gemini -y -p " + shellQuote(compiledPrompt) + " 2>&1";
        String shellCommand = "cd " + shellQuote(workingDirectory.toString())
                + " && export HOME=" + shellQuote(workspaceHome.toString())
                + " PATH=\"$PATH:/usr/local/bin:/usr/bin:/opt/jupiter-cli/bin\""
                + " TERM=xterm-256color"
                + " && " + buildResourceLimitCommand(admin)
                + " && " + buildGeminiBootstrap(workspaceHome)
                + " && " + command;

        ExecutionResult result = executeCommand(shellCommand, GEMINI_TIMEOUT_SECONDS);
        String relativeDirectory = workspaceRoot.equals(workingDirectory)
                ? ""
                : workspaceRoot.relativize(workingDirectory).toString().replace('\\', '/');
        WorkspaceGeminiResponse response = new WorkspaceGeminiResponse(
                prompt,
                result.output().trim(),
                relativeDirectory,
                result.exitCode(),
                result.timedOut(),
                contextFiles);
        addLog(username, "gemini", relativeDirectory, command, response.exitCode(), response.timedOut(), response.output(), "");
        return response;
    }

    private <T> T withExecutionPermit(String username, boolean admin, Supplier<T> action) {
        Semaphore semaphore = executionSemaphoresByUser.computeIfAbsent(
                username,
                ignored -> new Semaphore(admin ? ADMIN_MAX_PARALLEL_EXECUTIONS : USER_MAX_PARALLEL_EXECUTIONS));
        boolean acquired = semaphore.tryAcquire();
        if (!acquired) {
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Too many concurrent executions for this user. Retry after current job completes.");
        }
        try {
            return action.get();
        } finally {
            semaphore.release();
        }
    }

    private String buildPythonCommand(Path file) {
        return "python3 " + shellQuote(file.toString());
    }

    private boolean shouldAttemptAutoFix(PythonExecutionResult result) {
        return result.exitCode() != 0 && !result.timedOut();
    }

    private String buildAutoFixPrompt(String relativePath, String stdout, String stderr) {
        return """
                You are fixing a Python file after a failed run.
                Target file: %s
                Requirements:
                - edit only files inside current workspace
                - keep the original behavior intent
                - fix root-cause errors shown below
                - do not add markdown explanation, apply file edits directly
                Recent stdout:
                %s

                Recent stderr:
                %s
                """.formatted(
                relativePath,
                truncate(stdout == null ? "" : stdout.trim()),
                truncate(stderr == null ? "" : stderr.trim()));
    }

    private String buildExecutionSummary(String stdout, String stderr, int exitCode, boolean timedOut) {
        if (timedOut) {
            return "실행이 제한 시간 내 종료되지 않았습니다. 무한 루프/대기 입력 여부를 확인하세요.";
        }
        if (exitCode == 0) {
            String trimmed = (stdout == null ? "" : stdout.trim());
            if (trimmed.isBlank()) {
                return "실행은 성공(exitCode=0)했지만 출력(stdout)이 비어 있습니다.";
            }
            String firstLine = trimmed.lines().findFirst().orElse("");
            return "실행 성공(exitCode=0). 주요 출력: " + truncate(firstLine);
        }
        String errLine = (stderr == null ? "" : stderr.trim()).lines().findFirst().orElse("");
        if (errLine.isBlank()) {
            return "실행 실패(exitCode=" + exitCode + "). stderr가 비어 있어 전체 로그 확인이 필요합니다.";
        }
        return "실행 실패(exitCode=" + exitCode + "). 대표 오류: " + truncate(errLine);
    }

    private String buildResourceLimitCommand(boolean admin) {
        int cpu = admin ? ADMIN_CPU_SECONDS : USER_CPU_SECONDS;
        int vmemKb = admin ? ADMIN_VMEM_KB : USER_VMEM_KB;
        return "ulimit -t " + cpu + " && ulimit -v " + vmemKb;
    }

    private List<String> resolveContextFiles(List<String> requestContextFiles, String filePath, String username, boolean admin) {
        List<String> candidates = new ArrayList<>();
        if (requestContextFiles != null) {
            candidates.addAll(requestContextFiles.stream()
                    .filter(path -> path != null && !path.isBlank())
                    .map(String::trim)
                    .distinct()
                    .limit(8)
                    .toList());
        }
        if ((candidates.isEmpty()) && filePath != null && !filePath.isBlank()) {
            candidates.add(filePath.trim());
        }
        List<String> resolved = new ArrayList<>();
        for (String candidate : candidates) {
            Path file = fileService.resolveWorkspacePath(candidate, username, admin);
            if (Files.exists(file) && !Files.isDirectory(file)) {
                resolved.add(candidate);
            }
        }
        return resolved;
    }

    private String buildPromptWithContext(String prompt, List<String> contextFiles, String username, boolean admin) {
        if (contextFiles.isEmpty()) {
            return prompt;
        }
        StringBuilder builder = new StringBuilder();
        builder.append(prompt).append("\n\n");
        builder.append("Additional workspace context files:\n");
        for (String contextFile : contextFiles) {
            Path file = fileService.resolveWorkspacePath(contextFile, username, admin);
            String content;
            try {
                content = Files.readString(file);
            } catch (Exception ex) {
                content = "[unable to read file]";
            }
            builder.append("\n--- FILE: ").append(contextFile).append(" ---\n");
            builder.append(truncate(content)).append('\n');
        }
        builder.append("\nUse these files as context while applying workspace changes.");
        return builder.toString();
    }

    public List<WorkspaceExecutionLogDto> listExecutionLogs(String username, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, MAX_LOGS_PER_USER));
        ArrayDeque<WorkspaceExecutionLogDto> queue = executionLogsByUser.get(username);
        if (queue == null || queue.isEmpty()) {
            return List.of();
        }
        synchronized (queue) {
            return queue.stream().limit(safeLimit).toList();
        }
    }

    private Path resolveWorkingDirectory(
            String directoryPath,
            String filePath,
            String username,
            boolean admin,
            Path workspaceRoot) {
        if (filePath != null && !filePath.isBlank()) {
            Path file = fileService.resolveWorkspacePath(filePath.trim(), username, admin);
            if (!java.nio.file.Files.exists(file)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Selected file was not found");
            }
            if (java.nio.file.Files.isDirectory(file)) {
                return file;
            }
            Path parent = file.getParent();
            return parent == null ? workspaceRoot : parent;
        }
        if (directoryPath != null && !directoryPath.isBlank()) {
            Path directory = fileService.resolveWorkspacePath(directoryPath.trim(), username, admin);
            if (!java.nio.file.Files.exists(directory) || !java.nio.file.Files.isDirectory(directory)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Selected directory was not found");
            }
            return directory;
        }
        return workspaceRoot;
    }

    private String buildGeminiBootstrap(Path workspaceHome) {
        String home = workspaceHome.toString().replace("\\", "\\\\").replace("\"", "\\\"");
        String settingsJson = """
                {
                  "security": {
                    "folderTrust": {
                      "enabled": true
                    },
                    "auth": {
                      "selectedType": "oauth-personal",
                      "useExternal": true
                    }
                  },
                  "screenReader": false
                }
                """;
        String trustedFoldersJson = """
                {
                  "%s": "TRUST_FOLDER"
                }
                """.formatted(home);
        return "mkdir -p \"$HOME/.gemini\""
                + " && if [ -d /workspace-data/users/admin1/.gemini ]; then cp -f /workspace-data/users/admin1/.gemini/* \"$HOME/.gemini/\" 2>/dev/null || true; fi"
                + " && printf %s " + shellQuote(settingsJson) + " > \"$HOME/.gemini/settings.json\""
                + " && printf %s " + shellQuote(trustedFoldersJson) + " > \"$HOME/.gemini/trustedFolders.json\"";
    }

    private ExecutionResult executeCommand(String shellCommand, long timeoutSeconds) {
        Pod pod = resolveCliPod();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CountDownLatch done = new CountDownLatch(1);
        ExecWatch watch = null;
        try {
            watch = kubernetesClient.pods()
                    .inNamespace(appProperties.namespace())
                    .withName(pod.getMetadata().getName())
                    .writingOutput(output)
                    .writingError(output)
                    .usingListener(new ExecListener() {
                        @Override
                        public void onOpen() {
                        }

                        @Override
                        public void onFailure(Throwable t, io.fabric8.kubernetes.client.dsl.ExecListener.Response failureResponse) {
                            done.countDown();
                        }

                        @Override
                        public void onClose(int code, String reason) {
                            done.countDown();
                        }
                    })
                    .exec("sh", "-lc", shellCommand);

            boolean finished = done.await(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                return new ExecutionResult(output.toString(StandardCharsets.UTF_8), -1, true);
            }
            Integer exitCode = watch.exitCode().getNow(0);
            return new ExecutionResult(output.toString(StandardCharsets.UTF_8), exitCode == null ? 0 : exitCode, false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Command execution interrupted", e);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unable to execute command", e);
        } finally {
            if (watch != null) {
                try {
                    watch.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private Pod resolveCliPod() {
        List<Pod> pods = kubernetesClient.pods()
                .inNamespace(appProperties.namespace())
                .withLabel("app", "jupiter-cli")
                .list()
                .getItems();
        return pods.stream()
                .filter(pod -> pod.getStatus() != null && "Running".equalsIgnoreCase(pod.getStatus().getPhase()))
                .min(Comparator.comparing(pod -> pod.getMetadata().getName()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "No running jupiter-cli pod found"));
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private void addLog(
            String username,
            String type,
            String targetPath,
            String command,
            int exitCode,
            boolean timedOut,
            String stdout,
            String stderr) {
        String output = mergeOutput(stdout, stderr);
        WorkspaceExecutionLogDto log = new WorkspaceExecutionLogDto(
                UUID.randomUUID().toString(),
                type,
                targetPath == null ? "" : targetPath,
                command,
                exitCode,
                timedOut,
                truncate(output),
                Instant.now());
        ArrayDeque<WorkspaceExecutionLogDto> queue = executionLogsByUser.computeIfAbsent(username, unused -> new ArrayDeque<>());
        synchronized (queue) {
            queue.addFirst(log);
            while (queue.size() > MAX_LOGS_PER_USER) {
                queue.removeLast();
            }
        }
    }

    private String mergeOutput(String stdout, String stderr) {
        String safeStdout = stdout == null ? "" : stdout.trim();
        String safeStderr = stderr == null ? "" : stderr.trim();
        if (safeStdout.isBlank() && safeStderr.isBlank()) {
            return "";
        }
        if (safeStderr.isBlank()) {
            return safeStdout;
        }
        if (safeStdout.isBlank()) {
            return "[stderr]\n" + safeStderr;
        }
        return safeStdout + "\n\n[stderr]\n" + safeStderr;
    }

    private String truncate(String output) {
        if (output.length() <= MAX_OUTPUT_CHARS) {
            return output;
        }
        return output.substring(0, MAX_OUTPUT_CHARS) + "\n...(truncated)";
    }

    private record ExecutionResult(String output, int exitCode, boolean timedOut) {
    }

    private record PythonExecutionResult(String stdout, String stderr, int exitCode, boolean timedOut) {
    }
}
