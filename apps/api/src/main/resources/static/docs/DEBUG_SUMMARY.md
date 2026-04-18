# Jupiter Debug Summary

Implemented components:

- `09.web` React workspace browser, terminal bridge, editor, RAG panel, and Python execution
- `09.web` Spring Boot API for auth, file services, RAG query/save, and workspace persistence
- `09.web` batch assets for DB bootstrap and recurring ingest/aggregate work
- `99.debug` cluster checks, Nexus tag checks, and registry HTTP configuration helper

Workspace flow:

1. User logs in through the workspace UI.
2. The browser loads the user workspace tree from the API.
3. Files can be edited, uploaded, downloaded, renamed, or executed.
4. RAG questions can be asked and saved into the authenticated workspace.
5. The terminal panel streams `codex` or `gemini` output over WebSocket.

Known operational risk:

- The cluster still depends on the Nexus HTTP registry being trusted by containerd.
- If the registry trust is missing, source image pulls or package installs may fail.

Useful debug files:

- `/apps/kube_shell/99.debug/01.cluster-debug.sh`
- `/apps/kube_shell/99.debug/02.nexus-jupiter-tags.sh`
- `/apps/kube_shell/99.debug/03.enable-nexus-http-registry.sh`
