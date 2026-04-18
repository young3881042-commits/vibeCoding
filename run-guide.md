# Jupiter Workspace 실행 방법

실행 순서: **DB → API → Web**

# 1. DB 실행
cd infra/db/docker
docker compose up -d

# 2. API 실행
cd ../../apps/api
cp .env.example .env
./run-local.sh

# 3. Web 실행
cd ../web
cp .env.example .env
./run-local.sh
