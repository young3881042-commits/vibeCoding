package com.platform.jupiter.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.platform.jupiter.config.AppProperties;
import com.platform.jupiter.files.FileService;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ChatService {
    private static final DateTimeFormatter FILE_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
            .withZone(ZoneId.of("Asia/Seoul"));

    private final FileService fileService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final AppProperties appProperties;
    private final ChatCredentialService chatCredentialService;

    public ChatService(FileService fileService, ObjectMapper objectMapper, AppProperties appProperties, ChatCredentialService chatCredentialService) {
        this.fileService = fileService;
        this.objectMapper = objectMapper;
        this.appProperties = appProperties;
        this.chatCredentialService = chatCredentialService;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .build();
    }

    public ChatResponse chat(ChatRequest request, String username, boolean admin) {
        String assistantMessage = requestModel(request, username);
        Instant now = Instant.now();
        String transcriptPath = resolveTranscriptPath(request, now);
        String title = resolveTitle(request);
        List<ChatMessage> transcriptMessages = new ArrayList<>(request.messages());
        transcriptMessages.add(new ChatMessage("assistant", assistantMessage));
        fileService.writeWorkspaceFile(transcriptPath, renderTranscript(request, transcriptMessages, title, now), username, admin);
        return new ChatResponse(assistantMessage, transcriptPath, title, now);
    }

    private String requestModel(ChatRequest request, String username) {
        try {
            String payload = objectMapper.writeValueAsString(buildPayload(request));
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(normalizeBaseUrl(request.baseUrl()) + "/chat/completions"))
                    .timeout(Duration.ofSeconds(120))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8));
            String apiKey = resolveApiKey(request, username);
            if (apiKey != null && !apiKey.isBlank()) {
                builder.header("Authorization", "Bearer " + apiKey.trim());
            }

            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Model API request failed: HTTP " + response.statusCode() + " " + summarize(response.body()));
            }
            JsonNode root = objectMapper.readTree(response.body());
            String content = extractAssistantMessage(root);
            if (content.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Model API returned an empty answer");
            }
            return content;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Unable to parse model API response", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Model API request was interrupted", e);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid API base URL", e);
        }
    }

    private Map<String, Object> buildPayload(ChatRequest request) {
        List<Map<String, String>> messages = new ArrayList<>();
        if (request.systemPrompt() != null && !request.systemPrompt().isBlank()) {
            messages.add(Map.of("role", "system", "content", request.systemPrompt().trim()));
        }
        for (ChatMessage message : request.messages()) {
            messages.add(Map.of("role", message.role().trim(), "content", message.content()));
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", request.model().trim());
        payload.put("messages", messages);
        return payload;
    }

    private String extractAssistantMessage(JsonNode root) {
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

    private String resolveTranscriptPath(ChatRequest request, Instant now) {
        if (request.filePath() != null && !request.filePath().isBlank()) {
            return request.filePath().trim();
        }
        String directoryPath = request.directoryPath() == null ? "" : request.directoryPath().trim();
        String filename = FILE_STAMP.format(now) + "-" + slugify(resolveTitle(request)) + ".md";
        if (directoryPath.isBlank()) {
            return filename;
        }
        return directoryPath + "/" + filename;
    }

    private String resolveTitle(ChatRequest request) {
        if (request.title() != null && !request.title().isBlank()) {
            return request.title().trim();
        }
        for (int index = request.messages().size() - 1; index >= 0; index--) {
            ChatMessage message = request.messages().get(index);
            if ("user".equalsIgnoreCase(message.role()) && !message.content().isBlank()) {
                return summarize(message.content());
            }
        }
        return "chat-session";
    }

    private String renderTranscript(ChatRequest request, List<ChatMessage> messages, String title, Instant savedAt) {
        StringBuilder builder = new StringBuilder();
        builder.append("# ").append(title).append("\n\n");
        builder.append("- saved_at: ").append(savedAt).append("\n");
        builder.append("- provider: ").append(request.providerId().trim()).append("\n");
        builder.append("- model: ").append(request.model().trim()).append("\n");
        builder.append("- api_base: ").append(normalizeBaseUrl(request.baseUrl())).append("\n");
        builder.append("- directory: ").append(request.directoryPath() == null || request.directoryPath().isBlank() ? "/" : request.directoryPath().trim()).append("\n");
        builder.append("\n");
        if (request.systemPrompt() != null && !request.systemPrompt().isBlank()) {
            builder.append("## System\n\n");
            builder.append(request.systemPrompt().trim()).append("\n\n");
        }
        builder.append("## Conversation\n\n");
        for (ChatMessage message : messages) {
            builder.append("### ").append(message.role().trim()).append("\n\n");
            builder.append(message.content().trim()).append("\n\n");
        }
        return builder.toString().trim() + "\n";
    }

    private String normalizeBaseUrl(String baseUrl) {
        String trimmed = baseUrl.trim();
        if (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        if (!trimmed.matches(".*/v\\d[^/]*(/.*)?$")) {
            trimmed = trimmed + "/v1";
        }
        return trimmed;
    }

    private String resolveApiKey(ChatRequest request, String username) {
        String providerId = request.providerId() == null ? "" : request.providerId().trim().toLowerCase();
        if ("openai".equals(providerId)) {
            return chatCredentialService.resolveOpenAiApiKey(username)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "OpenAI API key is not configured"));
        }
        if ("gemini".equals(providerId)) {
            return chatCredentialService.resolveGeminiAuthorization(username)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini is not configured for this server"));
        }
        String normalizedBaseUrl = normalizeBaseUrl(request.baseUrl()).toLowerCase();
        String model = request.model() == null ? "" : request.model().trim().toLowerCase();
        if (normalizedBaseUrl.contains("api.openai.com") || model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
            return chatCredentialService.resolveOpenAiApiKey(username)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "OpenAI API key is not configured"));
        }
        if (normalizedBaseUrl.contains("x.ai") || model.startsWith("grok")) {
            String apiKey = appProperties.grokApiKey();
            if (apiKey == null || apiKey.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Server Grok API key is not configured");
            }
            return apiKey;
        }
        if (normalizedBaseUrl.contains("generativelanguage.googleapis.com") || model.startsWith("gemini")) {
            return chatCredentialService.resolveGeminiAuthorization(username)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini is not configured for this server"));
        }
        return "";
    }

    private String summarize(String value) {
        String normalized = value.replaceAll("\\s+", " ").trim();
        if (normalized.length() <= 48) {
            return normalized;
        }
        return normalized.substring(0, 48).trim() + "...";
    }

    private String slugify(String value) {
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKD)
                .replaceAll("[^\\p{Alnum}\\s-]", " ")
                .replaceAll("\\s+", "-")
                .replaceAll("-{2,}", "-")
                .toLowerCase()
                .replaceAll("(^-|-$)", "");
        return normalized.isBlank() ? "chat-session" : normalized;
    }
}
