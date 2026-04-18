package com.platform.jupiter.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.platform.jupiter.config.AppProperties;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ChatCredentialService {
    private static final String PROVIDER_OPENAI = "openai";
    private static final String PROVIDER_GEMINI = "gemini";

    private final JdbcTemplate jdbcTemplate;
    private final AppProperties appProperties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public ChatCredentialService(JdbcTemplate jdbcTemplate, AppProperties appProperties, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.appProperties = appProperties;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .build();
    }

    @PostConstruct
    void initialize() {
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS app_user_chat_credential (
                    username VARCHAR(40) NOT NULL,
                    provider VARCHAR(24) NOT NULL,
                    api_key TEXT NULL,
                    access_token TEXT NULL,
                    refresh_token TEXT NULL,
                    expires_at TIMESTAMP(6) NULL,
                    created_at TIMESTAMP(6) NOT NULL,
                    updated_at TIMESTAMP(6) NOT NULL,
                    PRIMARY KEY (username, provider)
                )
                """);
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS app_user_chat_oauth_state (
                    state VARCHAR(128) NOT NULL PRIMARY KEY,
                    username VARCHAR(40) NOT NULL,
                    provider VARCHAR(24) NOT NULL,
                    code_verifier VARCHAR(255) NOT NULL,
                    expires_at TIMESTAMP(6) NOT NULL,
                    created_at TIMESTAMP(6) NOT NULL
                )
                """);
    }

    public List<ChatProviderStatus> listProviderStatuses(String username) {
        boolean geminiEnabled = isGeminiOauthConfigured();
        boolean openAiConnected = findCredential(username, PROVIDER_OPENAI)
                .map(credential -> credential.apiKey() != null && !credential.apiKey().isBlank())
                .orElse(false);
        boolean openAiServerConfigured = appProperties.openAiApiKey() != null && !appProperties.openAiApiKey().isBlank();
        boolean geminiConnected = findCredential(username, PROVIDER_GEMINI)
                .map(credential -> credential.refreshToken() != null && !credential.refreshToken().isBlank())
                .orElse(false);

        return List.of(
                new ChatProviderStatus(
                        PROVIDER_OPENAI,
                        "OpenAI",
                        true,
                        openAiConnected || openAiServerConfigured,
                        openAiConnected ? "사용자 키가 서버에 저장되어 있습니다." : (openAiServerConfigured ? "서버 기본 OpenAI 키를 사용합니다." : "연결되지 않음"),
                        "https://api.openai.com",
                        "gpt-4o-mini"),
                new ChatProviderStatus(
                        PROVIDER_GEMINI,
                        "Google Gemini",
                        geminiEnabled,
                        geminiConnected,
                        geminiEnabled
                                ? (geminiConnected ? "Google 로그인 완료" : "Google 계정을 연결하세요.")
                                : "Gemini OAuth가 서버에 설정되지 않았습니다.",
                        "https://generativelanguage.googleapis.com/v1beta/openai",
                        "gemini-2.5-flash"));
    }

    public void saveOpenAiApiKey(String username, String apiKey) {
        String trimmed = apiKey == null ? "" : apiKey.trim();
        if (trimmed.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "OpenAI API key is required");
        }
        upsertCredential(username, PROVIDER_OPENAI, trimmed, null, null, null);
    }

    public void deleteCredential(String username, String provider) {
        jdbcTemplate.update("DELETE FROM app_user_chat_credential WHERE username = ? AND provider = ?", username, provider);
    }

    public String createGeminiAuthorizationUrl(String username) {
        if (!isGeminiOauthConfigured()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini OAuth is not configured on the server");
        }

        cleanupExpiredOauthState();
        String state = randomToken(24);
        String codeVerifier = randomToken(48);
        String codeChallenge = sha256Base64Url(codeVerifier);
        Instant now = Instant.now();
        Instant expiresAt = now.plus(Duration.ofMinutes(10));

        jdbcTemplate.update(
                """
                INSERT INTO app_user_chat_oauth_state (state, username, provider, code_verifier, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    username = VALUES(username),
                    provider = VALUES(provider),
                    code_verifier = VALUES(code_verifier),
                    expires_at = VALUES(expires_at),
                    created_at = VALUES(created_at)
                """,
                state,
                username,
                PROVIDER_GEMINI,
                codeVerifier,
                Timestamp.from(expiresAt),
                Timestamp.from(now));

        return "https://accounts.google.com/o/oauth2/v2/auth"
                + "?client_id=" + encode(appProperties.geminiOauthClientId())
                + "&redirect_uri=" + encode(appProperties.geminiOauthRedirectUri())
                + "&response_type=code"
                + "&scope=" + encode("https://www.googleapis.com/auth/generative-language.retriever https://www.googleapis.com/auth/cloud-platform")
                + "&access_type=offline"
                + "&prompt=consent"
                + "&state=" + encode(state)
                + "&code_challenge=" + encode(codeChallenge)
                + "&code_challenge_method=S256";
    }

    public GeminiOauthResult completeGeminiAuthorization(String code, String state) {
        if (code == null || code.isBlank() || state == null || state.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing Gemini OAuth code or state");
        }

        cleanupExpiredOauthState();
        PendingOauthState pending = jdbcTemplate.query(
                        "SELECT state, username, provider, code_verifier, expires_at FROM app_user_chat_oauth_state WHERE state = ?",
                        this::mapPendingState,
                        state.trim())
                .stream()
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired Gemini OAuth state"));

        if (pending.expiresAt().isBefore(Instant.now())) {
            jdbcTemplate.update("DELETE FROM app_user_chat_oauth_state WHERE state = ?", pending.state());
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expired Gemini OAuth state");
        }

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://oauth2.googleapis.com/token"))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(buildAuthorizationCodeBody(code.trim(), pending.codeVerifier()), StandardCharsets.UTF_8))
                .build();
        TokenResponse tokenResponse = sendTokenRequest(request, "Gemini OAuth token exchange failed");
        Instant expiresAt = Instant.now().plusSeconds(Math.max(60, tokenResponse.expiresIn()));

        upsertCredential(
                pending.username(),
                PROVIDER_GEMINI,
                null,
                tokenResponse.accessToken(),
                tokenResponse.refreshToken(),
                expiresAt);
        jdbcTemplate.update("DELETE FROM app_user_chat_oauth_state WHERE state = ?", pending.state());
        return new GeminiOauthResult(pending.username(), expiresAt);
    }

    public Optional<String> resolveOpenAiApiKey(String username) {
        Optional<StoredCredential> credential = findCredential(username, PROVIDER_OPENAI);
        if (credential.isPresent() && credential.get().apiKey() != null && !credential.get().apiKey().isBlank()) {
            return Optional.of(credential.get().apiKey().trim());
        }
        if (appProperties.openAiApiKey() != null && !appProperties.openAiApiKey().isBlank()) {
            return Optional.of(appProperties.openAiApiKey().trim());
        }
        return Optional.empty();
    }

    public Optional<String> resolveGeminiAccessToken(String username) {
        StoredCredential credential = findCredential(username, PROVIDER_GEMINI)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini account is not connected"));
        if (credential.refreshToken() == null || credential.refreshToken().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini refresh token is missing");
        }
        if (credential.accessToken() != null
                && !credential.accessToken().isBlank()
                && credential.expiresAt() != null
                && credential.expiresAt().isAfter(Instant.now().plusSeconds(60))) {
            return Optional.of(credential.accessToken().trim());
        }
        return Optional.of(refreshGeminiAccessToken(credential));
    }

    public boolean isGeminiOauthConfigured() {
        return appProperties.geminiOauthClientId() != null
                && !appProperties.geminiOauthClientId().isBlank()
                && appProperties.geminiOauthRedirectUri() != null
                && !appProperties.geminiOauthRedirectUri().isBlank();
    }

    private String refreshGeminiAccessToken(StoredCredential credential) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://oauth2.googleapis.com/token"))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(buildRefreshTokenBody(credential.refreshToken()), StandardCharsets.UTF_8))
                .build();
        TokenResponse tokenResponse = sendTokenRequest(request, "Gemini OAuth refresh failed");
        Instant expiresAt = Instant.now().plusSeconds(Math.max(60, tokenResponse.expiresIn()));
        upsertCredential(
                credential.username(),
                PROVIDER_GEMINI,
                null,
                tokenResponse.accessToken(),
                credential.refreshToken(),
                expiresAt);
        return tokenResponse.accessToken().trim();
    }

    private TokenResponse sendTokenRequest(HttpRequest request, String errorMessage) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        errorMessage + ": HTTP " + response.statusCode() + " " + summarize(response.body()));
            }
            JsonNode node = objectMapper.readTree(response.body());
            String accessToken = node.path("access_token").asText("").trim();
            String refreshToken = node.path("refresh_token").asText("").trim();
            long expiresIn = node.path("expires_in").asLong(3600);
            if (accessToken.isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, errorMessage + ": missing access token");
            }
            return new TokenResponse(accessToken, refreshToken, expiresIn);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, errorMessage + ": invalid response", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, errorMessage + ": interrupted", e);
        }
    }

    private void upsertCredential(
            String username,
            String provider,
            String apiKey,
            String accessToken,
            String refreshToken,
            Instant expiresAt) {
        Instant now = Instant.now();
        jdbcTemplate.update(
                """
                INSERT INTO app_user_chat_credential
                    (username, provider, api_key, access_token, refresh_token, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    api_key = VALUES(api_key),
                    access_token = VALUES(access_token),
                    refresh_token = COALESCE(NULLIF(VALUES(refresh_token), ''), refresh_token),
                    expires_at = VALUES(expires_at),
                    updated_at = VALUES(updated_at)
                """,
                username,
                provider,
                apiKey,
                accessToken,
                refreshToken,
                expiresAt == null ? null : Timestamp.from(expiresAt),
                Timestamp.from(now),
                Timestamp.from(now));
    }

    private Optional<StoredCredential> findCredential(String username, String provider) {
        return jdbcTemplate.query(
                        """
                        SELECT username, provider, api_key, access_token, refresh_token, expires_at
                        FROM app_user_chat_credential
                        WHERE username = ? AND provider = ?
                        """,
                        this::mapCredential,
                        username,
                        provider)
                .stream()
                .findFirst();
    }

    private StoredCredential mapCredential(ResultSet rs, int rowNum) throws SQLException {
        Timestamp expiresAt = rs.getTimestamp("expires_at");
        return new StoredCredential(
                rs.getString("username"),
                rs.getString("provider"),
                rs.getString("api_key"),
                rs.getString("access_token"),
                rs.getString("refresh_token"),
                expiresAt == null ? null : expiresAt.toInstant());
    }

    private PendingOauthState mapPendingState(ResultSet rs, int rowNum) throws SQLException {
        return new PendingOauthState(
                rs.getString("state"),
                rs.getString("username"),
                rs.getString("provider"),
                rs.getString("code_verifier"),
                rs.getTimestamp("expires_at").toInstant());
    }

    private void cleanupExpiredOauthState() {
        jdbcTemplate.update("DELETE FROM app_user_chat_oauth_state WHERE expires_at < ?", Timestamp.from(Instant.now()));
    }

    private String buildAuthorizationCodeBody(String code, String codeVerifier) {
        StringBuilder builder = new StringBuilder();
        builder.append("code=").append(encode(code));
        builder.append("&client_id=").append(encode(appProperties.geminiOauthClientId()));
        builder.append("&redirect_uri=").append(encode(appProperties.geminiOauthRedirectUri()));
        builder.append("&grant_type=authorization_code");
        builder.append("&code_verifier=").append(encode(codeVerifier));
        if (appProperties.geminiOauthClientSecret() != null && !appProperties.geminiOauthClientSecret().isBlank()) {
            builder.append("&client_secret=").append(encode(appProperties.geminiOauthClientSecret()));
        }
        return builder.toString();
    }

    private String buildRefreshTokenBody(String refreshToken) {
        StringBuilder builder = new StringBuilder();
        builder.append("client_id=").append(encode(appProperties.geminiOauthClientId()));
        builder.append("&grant_type=refresh_token");
        builder.append("&refresh_token=").append(encode(refreshToken));
        if (appProperties.geminiOauthClientSecret() != null && !appProperties.geminiOauthClientSecret().isBlank()) {
            builder.append("&client_secret=").append(encode(appProperties.geminiOauthClientSecret()));
        }
        return builder.toString();
    }

    private String summarize(String value) {
        String normalized = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        if (normalized.length() <= 160) {
            return normalized;
        }
        return normalized.substring(0, 160).trim() + "...";
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String randomToken(int bytes) {
        byte[] buffer = new byte[bytes];
        new java.security.SecureRandom().nextBytes(buffer);
        return HexFormat.of().formatHex(buffer);
    }

    private String sha256Base64Url(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private record StoredCredential(
            String username,
            String provider,
            String apiKey,
            String accessToken,
            String refreshToken,
            Instant expiresAt) {
    }

    private record PendingOauthState(
            String state,
            String username,
            String provider,
            String codeVerifier,
            Instant expiresAt) {
    }

    private record TokenResponse(String accessToken, String refreshToken, long expiresIn) {
    }

    public record GeminiOauthResult(String username, Instant expiresAt) {
    }
}
