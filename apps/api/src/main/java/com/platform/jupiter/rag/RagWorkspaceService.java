package com.platform.jupiter.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.platform.jupiter.chat.ChatCredentialService;
import com.platform.jupiter.files.FileService;
import com.platform.jupiter.files.FileTreeEntry;
import com.platform.jupiter.files.FileTreeResponse;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RagWorkspaceService {
    private static final DateTimeFormatter FILE_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
            .withZone(ZoneId.of("Asia/Seoul"));
    private static final int MAX_WORKSPACE_FILE_CHARS = 6000;
    private static final int MAX_WORKSPACE_DIRECTORY_FILES = 3;
    private static final int MAX_IMPORT_FILES = 12;
    private static final Set<String> TEXT_FILE_EXTENSIONS = Set.of(
            "txt", "md", "csv", "json", "log", "yaml", "yml",
            "py", "java", "js", "jsx", "ts", "tsx",
            "sql", "properties", "sh", "xml", "html", "css");
    private static final Set<String> RAG_IMPORT_EXTENSIONS = Set.of(
            "txt", "md", "csv", "json", "log", "yaml", "yml");

    private final RagService ragService;
    private final FileService fileService;
    private final ChatCredentialService chatCredentialService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public RagWorkspaceService(RagService ragService, FileService fileService, ChatCredentialService chatCredentialService, ObjectMapper objectMapper) {
        this.ragService = ragService;
        this.fileService = fileService;
        this.chatCredentialService = chatCredentialService;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .build();
    }

    public RagWorkspaceResponse answerAndSave(RagWorkspaceRequest request, String username, boolean admin) {
        RagService.RagRetrievalResult retrieval = ragService.retrieve(new RagQueryRequest(request.question(), request.topK()));
        WorkspaceContext workspaceContext = buildWorkspaceContext(request, username, admin);
        RagAnswerResponse response = generateAnswer(request.question(), request.topK(), retrieval, workspaceContext, username);
        String title = resolveTitle(request);
        String transcriptPath = resolveTranscriptPath(request, response.generatedAt());
        fileService.writeWorkspaceFile(transcriptPath, renderTranscript(response, title, transcriptPath), username, admin);
        return new RagWorkspaceResponse(
                response.question(),
                response.answer(),
                response.citations(),
                response.generatedAt(),
                transcriptPath,
                title);
    }

    public List<RagDocumentSummary> importWorkspaceSelection(RagWorkspaceImportRequest request, String username, boolean admin) {
        List<Path> files = resolveImportFiles(request, username, admin);
        if (files.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "가져올 수 있는 텍스트 파일이 없습니다.");
        }

        List<RagDocumentSummary> imported = new ArrayList<>();
        for (Path file : files) {
            String filename = file.getFileName() == null ? "document.txt" : file.getFileName().toString();
            imported.add(ragService.importWorkspaceFile(filename, file));
        }
        return imported;
    }

    private RagAnswerResponse generateAnswer(
            String question,
            Integer topK,
            RagService.RagRetrievalResult retrieval,
            WorkspaceContext workspaceContext,
            String username) {
        List<RagCitation> citations = mergeCitations(retrieval.citations(), workspaceContext.citations());
        try {
            String prompt = buildPrompt(question, retrieval.candidates(), workspaceContext);
            String answer = requestGemini(prompt, username);
            if (answer.isBlank()) {
                throw new IllegalStateException("empty gemini answer");
            }
            return new RagAnswerResponse(question, answer, citations, Instant.now());
        } catch (Exception exception) {
            RagAnswerResponse fallback = ragService.answer(new RagQueryRequest(question, topK));
            if (!fallback.answer().isBlank()) {
                return new RagAnswerResponse(
                        question,
                        fallback.answer(),
                        mergeCitations(fallback.citations(), workspaceContext.citations()),
                        Instant.now());
            }
            if (!workspaceContext.citations().isEmpty()) {
                return new RagAnswerResponse(
                        question,
                        "선택한 워크스페이스 파일이나 폴더 문맥은 잡혔지만 Gemini 답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
                        workspaceContext.citations(),
                        Instant.now());
            }
            return new RagAnswerResponse(
                    question,
                    "질문과 가까운 인덱스 문서나 현재 워크스페이스 문맥을 찾지 못했습니다. 다른 키워드로 다시 질문하거나 문서를 더 올려 주세요.",
                    citations,
                    Instant.now());
        }
    }

    private WorkspaceContext buildWorkspaceContext(RagWorkspaceRequest request, String username, boolean admin) {
        List<WorkspaceContextItem> items = new ArrayList<>();
        if (request.filePath() != null && !request.filePath().isBlank()) {
            WorkspaceContextItem selectedFile = loadWorkspaceFile(request.filePath().trim(), username, admin);
            if (selectedFile != null) {
                items.add(selectedFile);
                return new WorkspaceContext(items);
            }
        }

        if (request.directoryPath() == null || request.directoryPath().isBlank()) {
            return new WorkspaceContext(items);
        }

        FileTreeResponse tree = fileService.browseWorkspace(request.directoryPath().trim(), username, admin);
        List<FileTreeEntry> fileEntries = tree.entries().stream()
                .filter(entry -> "file".equals(entry.type()))
                .filter(entry -> isTextFile(entry.path()))
                .limit(MAX_WORKSPACE_DIRECTORY_FILES)
                .toList();

        for (FileTreeEntry entry : fileEntries) {
            WorkspaceContextItem item = loadWorkspaceFile(entry.path(), username, admin);
            if (item != null) {
                items.add(item);
            }
        }

        if (!items.isEmpty()) {
            return new WorkspaceContext(items);
        }

        StringBuilder listing = new StringBuilder();
        listing.append("Current folder entries:\n");
        List<FileTreeEntry> entries = tree.entries();
        for (int index = 0; index < Math.min(entries.size(), 10); index++) {
            FileTreeEntry entry = entries.get(index);
            listing.append("- ")
                    .append(entry.type())
                    .append(": ")
                    .append(entry.path())
                    .append("\n");
        }
        String directorySummary = listing.toString().trim();
        items.add(new WorkspaceContextItem(
                request.directoryPath().trim(),
                directorySummary,
                abbreviate(directorySummary, 240)));
        return new WorkspaceContext(items);
    }

    private List<Path> resolveImportFiles(RagWorkspaceImportRequest request, String username, boolean admin) {
        if (request.filePath() != null && !request.filePath().isBlank()) {
            Path file = fileService.resolveWorkspacePath(request.filePath().trim(), username, admin);
            if (!Files.exists(file) || Files.isDirectory(file) || !isRagImportFile(file.getFileName().toString())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "선택한 파일은 RAG로 가져올 수 없습니다.");
            }
            return List.of(file);
        }

        if (request.directoryPath() == null || request.directoryPath().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "폴더 또는 파일 경로가 필요합니다.");
        }

        Path directory = fileService.resolveWorkspacePath(request.directoryPath().trim(), username, admin);
        if (!Files.exists(directory) || !Files.isDirectory(directory)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "선택한 폴더를 찾을 수 없습니다.");
        }

        try (var stream = Files.walk(directory, 2)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(path -> isRagImportFile(path.getFileName().toString()))
                    .sorted(Comparator.naturalOrder())
                    .limit(MAX_IMPORT_FILES)
                    .toList();
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "워크스페이스 파일을 가져오지 못했습니다.", exception);
        }
    }

    private WorkspaceContextItem loadWorkspaceFile(String relativePath, String username, boolean admin) {
        try {
            if (!isTextFile(relativePath)) {
                return null;
            }
            Path path = fileService.resolveWorkspacePath(relativePath, username, admin);
            if (!Files.exists(path) || Files.isDirectory(path)) {
                return null;
            }
            String content = normalizeWhitespace(Files.readString(path, StandardCharsets.UTF_8));
            if (content.isBlank()) {
                return null;
            }
            String clipped = abbreviate(content, MAX_WORKSPACE_FILE_CHARS);
            return new WorkspaceContextItem(
                    relativePath,
                    clipped,
                    abbreviate(clipped, 240));
        } catch (IOException exception) {
            return null;
        }
    }

    private String buildPrompt(String question, List<RagService.RagContextChunk> chunks, WorkspaceContext workspaceContext) {
        StringBuilder builder = new StringBuilder();
        builder.append("You are a RAG assistant for a Korean portfolio workspace.\n");
        builder.append("Answer from the current workspace selection first when it is relevant.\n");
        builder.append("Then use indexed RAG context.\n");
        builder.append("If the available context is empty or insufficient, answer from general knowledge and explicitly say that the indexed docs or workspace selection did not fully cover it.\n");
        builder.append("Return a concise answer in Korean.\n\n");
        builder.append("Question:\n").append(question.trim()).append("\n\n");
        builder.append("Current workspace selection:\n");
        if (workspaceContext.items().isEmpty()) {
            builder.append("(no current workspace file or folder context was selected)\n\n");
        } else {
            for (int index = 0; index < workspaceContext.items().size(); index++) {
                WorkspaceContextItem item = workspaceContext.items().get(index);
                builder.append("[W").append(index + 1).append("] ")
                        .append(item.path())
                        .append("\n")
                        .append(item.content().trim())
                        .append("\n\n");
            }
        }
        builder.append("Indexed RAG context:\n");
        if (chunks.isEmpty()) {
            builder.append("(no relevant indexed documents were found)\n");
        } else {
            for (int index = 0; index < chunks.size(); index++) {
                RagService.RagContextChunk chunk = chunks.get(index);
                builder.append("[R").append(index + 1).append("] ")
                        .append(chunk.documentTitle())
                        .append(" (chunk ").append(chunk.chunkIndex()).append(", score ")
                        .append(chunk.score()).append(")\n")
                        .append(chunk.text().trim())
                        .append("\n\n");
            }
        }
        return builder.toString().trim();
    }

    private List<RagCitation> mergeCitations(List<RagCitation> ragCitations, List<RagCitation> workspaceCitations) {
        List<RagCitation> merged = new ArrayList<>(workspaceCitations.size() + ragCitations.size());
        merged.addAll(workspaceCitations);
        merged.addAll(ragCitations);
        return merged;
    }

    private String requestGemini(String prompt, String username) throws IOException, InterruptedException {
        String token = chatCredentialService.resolveGeminiAccessToken(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini account is not connected"));
        String payload = objectMapper.writeValueAsString(buildGeminiPayload(prompt));
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"))
                .timeout(Duration.ofSeconds(120))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Gemini request failed: HTTP " + response.statusCode());
        }
        JsonNode root = objectMapper.readTree(response.body());
        JsonNode content = root.path("choices").path(0).path("message").path("content");
        if (content.isTextual()) {
            return content.asText().trim();
        }
        if (content.isArray()) {
            StringBuilder builder = new StringBuilder();
            for (JsonNode item : content) {
                String text = item.path("text").asText("");
                if (!text.isBlank()) {
                    if (builder.length() > 0) {
                        builder.append("\n");
                    }
                    builder.append(text.trim());
                }
            }
            return builder.toString().trim();
        }
        return "";
    }

    private Object buildGeminiPayload(String prompt) {
        List<Object> messages = new ArrayList<>();
        messages.add(java.util.Map.of("role", "system", "content", "You are a concise assistant."));
        messages.add(java.util.Map.of("role", "user", "content", prompt));
        return java.util.Map.of(
                "model", "gemini-2.5-flash",
                "messages", messages);
    }

    private String renderTranscript(RagAnswerResponse response, String title, String transcriptPath) {
        StringBuilder builder = new StringBuilder();
        builder.append("# ").append(title).append("\n\n");
        builder.append("- generated_at: ").append(response.generatedAt()).append("\n");
        builder.append("- transcript_path: ").append(transcriptPath).append("\n\n");
        builder.append("## Question\n\n");
        builder.append(response.question().trim()).append("\n\n");
        builder.append("## Answer\n\n");
        builder.append(response.answer().trim()).append("\n\n");
        builder.append("## Citations\n\n");
        if (response.citations().isEmpty()) {
            builder.append("검색된 출처가 없습니다.\n");
        } else {
            for (int index = 0; index < response.citations().size(); index++) {
                RagCitation citation = response.citations().get(index);
                builder.append(index + 1).append(". ")
                        .append(citation.documentTitle())
                        .append(" [chunk ").append(citation.chunkIndex()).append("]")
                        .append(" score=").append(citation.score())
                        .append("\n");
                builder.append(citation.excerpt().trim()).append("\n\n");
            }
        }
        return builder.toString().trim() + "\n";
    }

    private String resolveTranscriptPath(RagWorkspaceRequest request, Instant generatedAt) {
        String filename = FILE_STAMP.format(generatedAt) + "-rag-" + slugify(resolveTitle(request)) + ".md";
        if (request.filePath() != null && !request.filePath().isBlank()) {
            String parent = parentPath(request.filePath().trim());
            return parent.isBlank() ? filename : parent + "/" + filename;
        }
        String directoryPath = request.directoryPath() == null ? "" : request.directoryPath().trim();
        if (directoryPath.isBlank()) {
            return filename;
        }
        return directoryPath + "/" + filename;
    }

    private String resolveTitle(RagWorkspaceRequest request) {
        if (request.title() != null && !request.title().isBlank()) {
            return request.title().trim();
        }
        String question = request.question().replaceAll("\\s+", " ").trim();
        if (question.length() <= 48) {
            return question;
        }
        return question.substring(0, 48).trim() + "...";
    }

    private boolean isTextFile(String path) {
        int index = path.lastIndexOf('.');
        if (index < 0 || index == path.length() - 1) {
            return false;
        }
        String extension = path.substring(index + 1).toLowerCase(Locale.ROOT);
        return TEXT_FILE_EXTENSIONS.contains(extension);
    }

    private boolean isRagImportFile(String path) {
        int index = path.lastIndexOf('.');
        if (index < 0 || index == path.length() - 1) {
            return false;
        }
        String extension = path.substring(index + 1).toLowerCase(Locale.ROOT);
        return RAG_IMPORT_EXTENSIONS.contains(extension);
    }

    private String parentPath(String path) {
        int index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        if (index < 0) {
            return "";
        }
        return path.substring(0, index);
    }

    private String normalizeWhitespace(String value) {
        return value.replace("\r", "\n")
                .replaceAll("\n{3,}", "\n\n")
                .replaceAll("[\\t\\x0B\\f]+", " ")
                .replaceAll(" {2,}", " ")
                .trim();
    }

    private String abbreviate(String value, int maxLength) {
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength - 1).trim() + "...";
    }

    private String slugify(String value) {
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKD)
                .replaceAll("[^\\p{Alnum}\\s-]", " ")
                .replaceAll("\\s+", "-")
                .replaceAll("-{2,}", "-")
                .toLowerCase()
                .replaceAll("(^-|-$)", "");
        return normalized.isBlank() ? "rag-session" : normalized;
    }

    private record WorkspaceContext(List<WorkspaceContextItem> items) {
        List<RagCitation> citations() {
            List<RagCitation> citations = new ArrayList<>();
            for (int index = 0; index < items.size(); index++) {
                WorkspaceContextItem item = items.get(index);
                citations.add(new RagCitation(
                        "workspace/" + item.path(),
                        "workspace:" + item.path(),
                        0,
                        Math.max(0.1, 1.0 - (index * 0.05)),
                        item.excerpt()));
            }
            return citations;
        }
    }

    private record WorkspaceContextItem(
            String path,
            String content,
            String excerpt) {
    }
}
