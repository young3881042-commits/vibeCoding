package com.platform.jupiter.files;

public record WorkspaceGeminiResponse(
        String prompt,
        String output,
        String workingDirectory,
        int exitCode,
        boolean timedOut) {
}
