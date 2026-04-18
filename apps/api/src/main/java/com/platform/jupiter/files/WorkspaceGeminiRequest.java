package com.platform.jupiter.files;

import jakarta.validation.constraints.NotBlank;

public record WorkspaceGeminiRequest(
        @NotBlank(message = "prompt is required")
        String prompt,
        String directoryPath,
        String filePath) {
}
