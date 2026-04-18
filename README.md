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
