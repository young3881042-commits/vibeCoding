package com.platform.jupiter.files;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

public record WorkspaceGeminiRequest(
        @NotBlank(message = "prompt is required")
        String prompt,
        String directoryPath,
        String filePath,
        List<String> contextFiles) {
}
