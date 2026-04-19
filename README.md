# Jupiter Workspace Repo

이 저장소는 홈 디렉터리 덤프를 그대로 올리지 않고, 실제로 관리할 코드와 실행 인프라만 남기는 구조로 정리했습니다.

## 왜 이 기술들을 쓰는가

- `React + Vite`
  빠르게 화면을 바꾸고, 채팅형 UI처럼 반복 수정이 많은 프론트 작업에 빌드/개발 속도가 좋습니다.
- `Spring Boot`
  인증, 파일 처리, RAG API, 외부 모델 연동을 한 서버에서 안정적으로 묶기 쉽고, 운영형 백엔드로 구조를 잡기 좋습니다.
- `MariaDB`
  세션, 사용자 설정, 채팅 자격정보 같은 정형 데이터를 다루기에 충분하고 현재 클러스터 운영 방식과도 잘 맞습니다.
- `Qdrant`
  문서/날씨 chunk를 벡터 검색으로 바로 붙이기 쉽고, RAG 실험을 빠르게 API 레벨로 연결하기 좋습니다.
- `Gemini`
  검색 결과를 그대로 보여주는 수준이 아니라, 검색 문맥을 붙여 자연어 답변을 생성하는 LLM 역할로 씁니다.
- `Kubernetes`
  `web`, `api`, `mariadb`, `qdrant`를 분리 배포하고 서비스별로 재시작/확장/상태 확인을 하기에 가장 편합니다.
- `Jenkins`
  지금 구조처럼 소스 Secret 갱신 + rollout restart 방식 배포를 표준화하기 좋고, 반복 수작업을 줄이는 데 효과가 큽니다.

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
현재 Jenkins 환경은 `GitHub push trigger` 플러그인이 없어 `pollSCM` 방식으로 자동 감시합니다.

## 현재 진행 사항

- [x] RAG 웹 UI를 채팅 중심 화면으로 단순화
- [x] 문서 + 날씨 데이터 색인 및 Qdrant 벡터 검색 연결
- [x] Gemini RAG 응답 경로와 서버 기본 인증 fallback 코드 추가
- [x] `develop` 기준 Jenkins 배포 파이프라인, 배포 스크립트, 스모크 테스트 추가
- [x] Jenkins 잡 `vibeCoding-develop` 등록
- [ ] Jenkins `vibeCoding-develop` 파이프라인 최종 성공 재확인
- [ ] 서버 공용 Gemini 자격정보(`APP_GEMINI_API_KEY` 또는 운영용 OAuth) 주입
- [ ] 실시간 날씨 API 외부 연결 안정화

## 앞으로 할 일

- [ ] `jupiter-gemini-api-key` 또는 운영용 Gemini OAuth 시크릿을 클러스터에 고정
- [ ] `/api/rag/query` 실호출 기준 Gemini 응답/인용 품질 점검
- [ ] 날씨 API 실패 시 내부 프록시 또는 캐시 갱신 경로 추가
- [ ] Jenkins 빌드 결과를 기준으로 실패 알림이나 롤백 기준 정리

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
