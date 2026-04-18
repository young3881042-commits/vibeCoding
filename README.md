# Jupiter Web Infra

The repository keeps application source in `apps/` and runtime/deploy assets in `infra/`.
For the web workload, the clean split is:

- `infra/web/docker`: local Docker runtime for the web app.
- `infra/web/kubernetes`: Kubernetes manifests for the same web workload.

This is easier to maintain than splitting the same service across separate `kube-infra` and `docker-infra` roots. The service-specific layout keeps the Dockerfile, manifests, and documentation together.

## Docker

Build and run the web app with Docker Compose:

```bash
docker compose -f infra/web/docker/docker-compose.yml up --build
```

If you prefer a plain `docker run`, use:

```bash
docker build -f infra/web/docker/Dockerfile apps/web -t jupiter-web:local
docker run --rm -p 5173:5173 --add-host=host.docker.internal:host-gateway -e VITE_API_PROXY=http://host.docker.internal:8080 jupiter-web:local
```

If the API runs somewhere else, override `VITE_API_PROXY`.

## Kubernetes

Load or publish the `jupiter-web:local` image, then apply the manifests:

```bash
kubectl apply -k infra/web/kubernetes
```

The manifests assume the existing `jupiter-api` service is available in the same cluster and use the `workspace.192.168.45.101.sslip.io` ingress host.
