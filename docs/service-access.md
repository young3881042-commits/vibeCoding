# Jupiter Service Access

Primary public gateway:

- URL: `http://192.168.45.101:31080`
- Purpose: React UI, `/api`, and `/docs`

Current public endpoints:

- Web UI: `http://192.168.45.101:31088`
- API: `http://192.168.45.101:31090`
- RAG UI: `http://192.168.45.101:31188`
- RAG API: `http://192.168.45.101:31190`
- Adminer: `http://192.168.45.101:31081`
- Kafka UI: `http://192.168.45.101:31082`
- Nexus UI: `http://192.168.45.101:32457`
- Launcher: `https://rancher.192.168.45.101.sslip.io:30443`

Credentials:

- Adminer
  - System: `MariaDB`
  - Server: `mariadb`
  - ID: `jupiter`
  - PW: `jupiter123`
  - DB: `jupiter_web`
- MariaDB direct
  - Host: `mariadb:3306`
  - ID: `jupiter`
  - PW: `jupiter123`
  - DB: `jupiter_web`
- Nexus
  - ID: `admin`
  - PW: `73781b61-2ed6-46a2-8b0d-da1be5464161`

Notes:

- `rag-web` is the document chat UI and `rag-api` serves the same RAG backend as the main API service.
- `jupiter-gateway` handles `/`, `/api`, and `/docs` path routing.
