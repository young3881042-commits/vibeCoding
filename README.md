<img width="1916" height="975" alt="image" src="https://github.com/user-attachments/assets/752ecd77-8075-4bb5-b945-4e2086389b93" /> 
<img width="1915" height="1037" alt="image" src="https://github.com/user-attachments/assets/d8ce5b6d-7f68-4a75-bdc9-4d17568dc651" />

# Jupiter Workspace

Jupiter Workspace는 분석 업무용 웹 UI, API, DB, 실행 인프라를 한 저장소에서 Google Api를 사용하기 위해 정리한 프로젝트입니다.

기존처럼 홈 디렉터리 전체를 그대로 옮기는 방식이 아니라, 실제로 관리해야 하는 코드와 실행 구성만 남겨서 **재현 가능하고 설명 가능한 구조**로 다시 정리했습니다.

---

## 프로젝트 개요

이 프로젝트는 단순한 웹 화면 저장소가 아니라, 분석 환경에서 필요한 기능을 한 번에 다루기 위한 개발용 워크스페이스입니다.

현재 기준으로 다음 범위를 포함합니다.

- React + Vite 기반 Web UI
- Spring Boot 기반 API 서버
- MariaDB 기반 DB 구성
- Docker / Kubernetes 실행 구조
- 개인별 분석환경을 만들기 위한 실행 템플릿
- Gemini 연동을 통해 분석환경에서 **파이썬 파일 생성, 수정, 실행 흐름을 처리할 수 있는 구조**

즉, 단순 CRUD 웹이 아니라 **사용자별 분석 공간을 만들고, 그 안에서 코드 실행과 AI 기반 작업 흐름까지 확장할 수 있도록 구성한 프로젝트**입니다.

---

## 주요 기능

### 1. Web UI
- React + Vite 기반 프론트엔드
- API와 연동되는 워크스페이스 화면 제공
- 로컬 실행 및 Docker 실행 지원
- 분석환경 접근용 기본 UI 구성

### 2. API 서버
- Spring Boot 기반 백엔드
- 인증 및 워크스페이스 관련 API 제공
- 파일/실행 요청 처리
- 정적 문서(`/docs`) 제공 가능
- 개인별 분석환경 생성 시 필요한 환경 설정값 관리

### 3. 개인별 분석환경 구성
- 사용자별 분석환경을 분리해서 구성할 수 있도록 설계
- 워크스페이스 루트, 스냅샷 경로, 실행 경로 등의 환경값 관리
- 분석환경에서 사용할 기본 서비스 주소를 API에서 통합 관리

### 4. Gemini 연동 기반 실행 템플릿
- Gemini를 연동하여 개인별 분석환경 안에서 작업 흐름을 확장할 수 있도록 구성
- 사용자가 요청한 작업에 맞게 **파이썬 파일을 생성**
- 기존 파일 내용을 바탕으로 **코드 수정**
- 필요한 경우 분석환경에서 **파이썬 실행 흐름까지 연결 가능**
- 이후 RAG나 실행 결과 요약 기능과 연결하기 쉬운 구조로 정리

즉, 이 프로젝트는 단순히 “AI 답변”만 붙이는 것이 아니라,  
**AI를 통해 실제 분석환경 안에서 파일 생성/수정/실행 흐름으로 이어질 수 있게 하는 기반 구조**를 목표로 합니다.

### 5. DB 초기화
- MariaDB 기반
- `schema.sql` 로 테이블 생성
- `data.sql` 로 초기 데이터 적재
- Docker 최초 기동 시 DB 초기화 가능

### 6. 실행 인프라 분리
- Web / API / DB 별 실행 구조 분리
- Docker와 Kubernetes를 각각 관리 가능
- 개발 환경과 배포 환경으로 확장 가능한 형태 유지

---

## 디렉터리 구조

```text
.
├── apps
│   ├── web
│   │   ├── src
│   │   ├── package.json
│   │   ├── run-local.sh
│   │   └── .env.example
│   └── api
│       ├── src
│       ├── build.gradle
│       ├── run-local.sh
│       └── .env.example
├── infra
│   ├── web
│   │   ├── docker
│   │   └── kubernetes
│   ├── api
│   │   ├── docker
│   │   └── kubernetes
│   ├── db
│   │   ├── docker
│   │   │   ├── docker-compose.yml
│   │   │   └── initdb
│   │   │       ├── 01-schema.sql
│   │   │       └── 02-data.sql
│   │   └── kubernetes
│   └── gateway
│       └── kubernetes
├── docs
├── scripts
└── README.md


## 🚀 진행 상태 체크리스트

### ✅ 완료된 작업

#### 기본 플랫폼 구성
- [x] React + Vite 기반 Web UI 구성
- [x] Spring Boot 기반 API 서버 구성
- [x] MariaDB 기반 DB 초기화 구조 구성 (`schema.sql`, `data.sql`)
- [x] Web / API / DB 디렉터리 구조 분리
- [x] Docker 실행 구조 구성
- [x] Kubernetes 배포 구조 구성

#### 실행 환경 및 워크스페이스
- [x] 사용자별 분석환경 생성 구조 설계
- [x] workspace / snapshot / 실행 경로 구조 정의
- [x] API에서 환경 설정값 관리 구조 구성

#### AI 연동 (기초)
- [x] Gemini API 연동
- [x] LLM 호출 → 응답 반환 기능 구현
- [x] 분석환경 내 파일 생성 기능 구현
- [x] 기존 파일 수정 흐름 구현
- [x] Python 실행 흐름 연결 (기초 수준)

#### 프로젝트 구조화
- [x] 재현 가능한 디렉터리 구조 정리
- [x] 실행 흐름 분리 (local / docker / kubernetes)
- [x] README 기반 설명 구조 작성

---

### ⚠️ 진행 중 / 일부 완료

#### 실행 환경 고도화
- [ ] 사용자별 리소스 제한 (CPU / Memory)
- [ ] 실행 환경 격리 강화 (보안 / 권한)
- [x] 실행 로그 수집 및 조회 기능 (API: `/api/workspace/executions`)
- [x] 작업 이력 관리 (최근 실행 100건/사용자 기준)

#### AI 실행 흐름
- [x] 코드 실행 결과 자동 요약 (`/api/workspace/run-python?summarize=true`)
- [x] 실행 실패 시 자동 수정 루프 (`/api/workspace/run-python?autoFix=true`)
- [x] 멀티 파일 컨텍스트 처리 (`/api/workspace/gemini` 요청의 `contextFiles`)

---

### ❌ 아직 안한 작업 (핵심 확장)

#### RAG / Vector DB
- [x] 문서 수집 파이프라인 1차 구축 (멀티도메인 자동 수집 API)
- [ ] Kafka 기반 데이터 처리 흐름 구성
- [ ] 문서 전처리 / 청크 분할 로직 구현
- [ ] Embedding 생성 로직 연결
- [ ] Vector DB 구축 (Milvus / Chroma / FAISS 등)
- [ ] 벡터 + 원문 + 메타데이터 저장 구조 설계
- [x] 질문 → Vector 검색 → 문서 retrieval 구현
- [x] RAG 구조로 LLM 프롬프트 구성 (Gemini 우선, OpenAI fallback)

#### 플랫폼 확장
- [ ] 사용자별 RAG 데이터 분리 구조
- [ ] 실시간 데이터 반영 파이프라인
- [ ] 검색 정확도 튜닝 (top-k / 필터링)
- [ ] 캐싱 전략 적용

#### DevOps / 운영
- [ ] CI/CD 파이프라인 구성 (Jenkins 등)
- [ ] 모니터링 (Prometheus / Grafana)
- [ ] 로그 수집 (ELK / Loki 등)
- [ ] 장애 대응 자동화

---

### 🔥 한 줄 현재 상태

```text
"AI 호출 + 실행 환경 플랫폼" → 완료  
"데이터 기반 AI (RAG)" → 이제 시작 단계


## ✅ 2026-04 업데이트

- `/api/rag/domains/refresh`로 금융/헬스케어/기술/제조/에너지/물류 분야 데이터를 자동 수집해 RAG 소스로 반영합니다.
- RAG 답변 생성은 Gemini를 우선 시도하고, 실패 시 OpenAI(`gpt-4o-mini`)로 자동 fallback 합니다.
- Web UI에서 `Domains` 버튼으로 다분야 데이터 재수집을 바로 실행할 수 있습니다.

## 🔐 LLM 서버 설정 (OpenAI API / Codex CLI Session Mode)

Jupiter Workspace의 LLM 요청은 **브라우저가 아니라 API 서버**에서 처리하도록 구성합니다.

- 프론트엔드에서 OpenAI/Codex API key를 입력/저장하지 않습니다.
- 서버는 `OPENAI_API_KEY`(또는 `APP_OPENAI_API_KEY`) 환경변수로 OpenAI를 호출합니다.
- 기본 모델은 `OPENAI_MODEL`(기본값: `gpt-5.2-codex`)로 관리합니다.

### 필수/권장 환경변수

```bash
OPENAI_API_KEY=sk-proj-xxxxx
OPENAI_MODEL=gpt-5.2-codex
ENABLE_CODEX_CLI_MODE=false
```

- `OPENAI_API_KEY` 미설정 시 OpenAI 모드는 동작하지 않습니다.
- `ENABLE_CODEX_CLI_MODE=true`일 때만 Codex CLI Session Mode를 UI에서 활성화합니다.

### Docker Compose에서 전달 예시

`docker-compose.yml` 또는 실행 셸에서:

```bash
export OPENAI_API_KEY=sk-proj-xxxxx
export OPENAI_MODEL=gpt-5.2-codex
export ENABLE_CODEX_CLI_MODE=false
docker compose up -d
```

### Kubernetes Secret 예시

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: jupiter-api-secrets
  namespace: jupiter
type: Opaque
stringData:
  OPENAI_API_KEY: sk-proj-xxxxx
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jupiter-api
  namespace: jupiter
spec:
  template:
    spec:
      containers:
        - name: api
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: jupiter-api-secrets
                  key: OPENAI_API_KEY
            - name: OPENAI_MODEL
              value: gpt-5.2-codex
            - name: ENABLE_CODEX_CLI_MODE
              value: \"false\"
```

### Codex CLI Session Mode 사전 준비

서버 런타임 사용자 기준으로 아래를 선행해야 합니다.

```bash
npm i -g @openai/codex
codex login
codex exec \"hello\"
```

주의:
- `~/.codex/auth.json`을 웹 서비스 코드에서 읽거나 프론트엔드로 전달하면 안 됩니다.
- 컨테이너/쿠버네티스에서 Codex CLI 모드를 쓸 때는 해당 런타임 계정의 로그인 세션/홈 디렉터리 마운트 정책을 별도로 설계해야 합니다.
