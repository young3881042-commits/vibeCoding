# Jupiter Workspace 실행 방법

실행 순서: **DB → API → Web**
# 1. 서버 배포 순서

## 1.1 DB 실행
cd infra/db/docker
docker compose up -d

## 1.2 API 실행
cd /apps/api
cp .env.example .env
./run-local.sh

## 1.3.1 Web 실행 (Local)
cd /apps/web
cp .env.example .env
./run-local.sh

## 1.3.2  Web 실행 (Docker)
cd infra/web/docker
docker compose up --build

# 2. Kubernetes 배포 순서
## 2.1 DB 배포
kubectl apply -f infra/db/kubernetes/mariadb.yaml

## 2.2 API 배포
kubectl apply -k infra/api/kubernetes

## 2.3 Web 배포
kubectl apply -k infra/web/kubernetes
