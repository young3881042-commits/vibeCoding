# External Hosting Notes

Recommended public exposure:

- `studio.example.com` -> `http://<node-or-lb>:31080`
- `nexus.example.com` -> `http://<node-or-lb>:30693`
- `db.example.com` is not recommended publicly; use Adminer behind access control if needed

Why the gateway exists:

- `/` routes to the React app
- `/api` routes to Spring Boot
- `/docs` routes to Spring static docs

Reverse proxy guidance:

- Preserve the gateway path prefix
- Allow WebSocket upgrade headers
- Forward `X-Forwarded-Proto` and `Host`
- Keep timeouts generous enough for long-running terminal sessions

TLS placement:

- Put TLS termination in the external load balancer or edge proxy
- Forward plain HTTP to `jupiter-gateway:8080` inside the cluster

DNS model:

- One public hostname for the gateway is enough
- Extra UI services can stay on NodePort if they are only used for internal access

Operational caveat:

- If Kubernetes nodes do not trust the Nexus HTTP registry, custom image pulls can fail with `ImagePullBackOff`
- Use `/apps/99.debug/03.enable-nexus-http-registry.sh` to configure containerd for `192.168.45.101:32050`
