package com.platform.jupiter.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AccountPasswordUpdateRequest(
        @NotBlank
        @Size(min = 4, max = 100)
        String currentPassword,
        @NotBlank
        @Size(min = 4, max = 100)
        String newPassword) {
}
