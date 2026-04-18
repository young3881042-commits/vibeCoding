package com.platform.jupiter.files;

import com.platform.jupiter.config.AppProperties;
import io.fabric8.kubernetes.api.model.Pod;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.dsl.ExecListener;
import io.fabric8.kubernetes.client.dsl.ExecWatch;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class WorkspaceExecutionService {
    private static final long PYTHON_TIMEOUT_SECONDS = 20L;
    private static final long GEMINI_TIMEOUT_SECONDS = 180L;

    private final AppProperties appProperties;
    private final KubernetesClient kubernetesClient;
    private final FileService fileService;

    public WorkspaceExecutionService(
            AppProperties appProperties,
            KubernetesClient kubernetesClient,
            FileService fileService) {
        this.appProperties = appProperties;
        this.kubernetesClient = kubernetesClient;
        this.fileService = fileService;
    }

    public WorkspaceRunResponse runPythonFile(String relativePath, String username, boolean admin) {
        if (relativePath == null || relativePath.isBlank() || !relativePath.endsWith(".py")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only .py files can be executed");
        }
        Path workspaceRoot = fileService.workspaceRootPath(username, admin);
        Path workspaceHome = fileService.workspaceHomePath(username, admin);
        Path file = fileService.resolveWorkspacePath(relativePath, username, admin);
        if (!java.nio.file.Files.exists(file) || java.nio.file.Files.isDirectory(file)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Python file not found");
        }

        String command = "python3 " + shellQuote(file.toString());
        String shellCommand = "cd " + shellQuote(workspaceRoot.toString())
                + " && export HOME=" + shellQuote(workspaceHome.toString())
                + " PATH=\"$PATH:/usr/local/bin:/usr/bin:/opt/jupiter-cli/bin\""
                + " TERM=xterm-256color"
                + " && " + command;

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

            boolean finished = done.await(PYTHON_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                return new WorkspaceRunResponse(
                        command,
                        -1,
                        stdout.toString(StandardCharsets.UTF_8),
                        stderr.toString(StandardCharsets.UTF_8),
                        true);
            }
            Integer exitCode = watch.exitCode().getNow(0);
            return new WorkspaceRunResponse(
                    command,
                    exitCode == null ? 0 : exitCode,
                    stdout.toString(StandardCharsets.UTF_8),
                    stderr.toString(StandardCharsets.UTF_8),
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
        String prompt = request.prompt() == null ? "" : request.prompt().trim();
        if (prompt.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prompt is required");
        }

        Path workspaceRoot = fileService.workspaceRootPath(username, admin);
        Path workspaceHome = fileService.workspaceHomePath(username, admin);
        Path workingDirectory = resolveWorkingDirectory(request.directoryPath(), request.filePath(), username, admin, workspaceRoot);

        String command = "CI=1 NO_COLOR=1 TERM=dumb /opt/jupiter-cli/bin/gemini -y -p " + shellQuote(prompt) + " 2>&1";
        String shellCommand = "cd " + shellQuote(workingDirectory.toString())
                + " && export HOME=" + shellQuote(workspaceHome.toString())
                + " PATH=\"$PATH:/usr/local/bin:/usr/bin:/opt/jupiter-cli/bin\""
                + " TERM=xterm-256color"
                + " && " + buildGeminiBootstrap(workspaceHome)
                + " && " + command;

        ExecutionResult result = executeCommand(shellCommand, GEMINI_TIMEOUT_SECONDS);
        String relativeDirectory = workspaceRoot.equals(workingDirectory)
                ? ""
                : workspaceRoot.relativize(workingDirectory).toString().replace('\\', '/');
        return new WorkspaceGeminiResponse(
                prompt,
                result.output().trim(),
                relativeDirectory,
                result.exitCode(),
                result.timedOut());
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

    private record ExecutionResult(String output, int exitCode, boolean timedOut) {
    }
}
