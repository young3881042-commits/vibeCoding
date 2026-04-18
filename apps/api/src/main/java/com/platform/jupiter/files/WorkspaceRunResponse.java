package com.platform.jupiter.files;

public record WorkspaceRunResponse(
        String command,
        int exitCode,
        String stdout,
        String stderr,
        boolean timedOut) {
}
