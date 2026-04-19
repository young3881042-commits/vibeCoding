# Jupiter Workspace Repo

이 저장소는 홈 디렉터리 덤프를 그대로 올리지 않고, 실제로 관리할 코드와 실행 인프라만 남기는 구조로 정리했습니다.

## 왜 `infra/web/{docker,kubernetes}` 인가

`kube-infra/`와 `docker-infra/`를 루트에서 나누면 같은 웹 서비스의 실행 방식만 달라져도 파일이 흩어집니다.  
이 저장소는 서비스 기준으로 묶었습니다.

- `apps/web`: React + Vite 기반 웹 UI
- `apps/api`: Spring Boot API
- `infra/web/docker`: 웹 단독 Docker 실행 경로
- `infra/web/kubernetes`: 웹 배포용 Kubernetes 매니페스트
- `scripts`: 운영 보조 스크립트

이렇게 두면 웹 관련 소스와 실행 경로를 한 번에 찾을 수 있고, 새 서버로 옮길 때도 서비스별로 옮기기 쉽습니다.

## 신규 서버에서 시작하기

### 1. Web

```bash
cd apps/web
cp .env.example .env
./run-local.sh
```

기본 포트는 `5173`이고, API 프록시는 `.env`의 `VITE_API_PROXY`에서 가져옵니다.

### 2. API

```bash
cd apps/api
cp .env.example .env
./run-local.sh
```

`run-local.sh`는 `.env`를 먼저 읽고 `gradle bootRun`을 실행합니다.  
새 서버에서는 MariaDB, workspace 경로, 외부 URL, OAuth 값만 `.env`에 맞게 넣으면 됩니다.

## Docker로 Web만 단독 실행

```bash
cd infra/web/docker
docker compose up --build
```

기본값은 `infra/web/docker/web.env`에 있습니다.

- `VITE_API_PROXY`: 웹이 붙을 API 주소
- `WEB_PORT`: 외부로 열 포트

단일 Docker 실행 기준으로는 웹만 띄우고, API는 별도 호스트나 기존 클러스터 주소를 바라보게 하는 구성이 가장 단순합니다.

## Kubernetes로 Web 배포

```bash
kubectl apply -k infra/web/kubernetes
```

웹 런타임 환경값은 `infra/web/kubernetes/web.env`를 ConfigMap으로 묶어서 넣습니다.  
기본 이미지는 `jupiter-web:local`로 두었고, 실제 서버에서는 레지스트리 이미지로 바꿔 쓰면 됩니다.

## Jenkins 자동배포

루트의 `Jenkinsfile`은 `develop` 브랜치 기준으로 다음 순서로 동작합니다.

1. 저장소 checkout
2. `scripts/deploy_jupiter_from_source.sh` 실행
3. `scripts/smoke_test_jupiter.sh` 실행

배포 방식은 현재 클러스터 구조에 맞춰 이미지 빌드가 아니라 소스 아카이브를 Kubernetes Secret으로 갱신하는 방식입니다.

- API: `jupiter-api-source`
- Web: `jupiter-frontend-archive-source`

Jenkins 잡은 Pipeline from SCM 또는 Multibranch Pipeline으로 연결하면 됩니다.
Webhook을 연결하면 `develop` push 시 자동으로 배포됩니다.

## Kafka 수집 스크립트

`scripts/admin1_kafka_collector.py`는 `admin1` 디렉터리를 재귀 순회하면서 파일별 JSON 스냅샷을 Kafka로 발행합니다.

예시:

```bash
python3 scripts/admin1_kafka_collector.py \
  --source-dir /workspace-data/users/admin1 \
  --bootstrap-servers localhost:9092 \
  --topic admin1.directory.snapshots
```

지원 사항:

- `confluent_kafka` 우선, 없으면 `kafka-python`, 둘 다 없으면 stdout fallback
- `--dry-run`, `--limit`, `--send-summary`
- hidden/binary 포함 여부 제어
- 환경변수 기본값 지원

주요 환경변수:

- `ADMIN1_SOURCE_DIR`
- `KAFKA_BOOTSTRAP_SERVERS`
- `KAFKA_TOPIC`
- `KAFKA_CLIENT_ID`
- `KAFKA_BACKEND`
- `ADMIN1_MAX_CONTENT_BYTES`
- `ADMIN1_INCLUDE_HIDDEN`
- `ADMIN1_INCLUDE_BINARY`

## 검증 메모

- `apps/web`: `npm run build` 통과
- `scripts/admin1_kafka_collector.py`: `python3 -m py_compile` 통과
- `apps/api`: 현재 이 환경에는 `gradle` 바이너리가 없어 로컬 컴파일 검증은 아직 못 했습니다
