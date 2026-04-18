# Gateway

이 디렉터리는 외부 요청을 웹(`/`), API(`/api`), 문서(`/docs`)로 라우팅하는 게이트웨이 구성을 위한 자리입니다.

예상 역할:
- `/` -> jupiter-web
- `/api` -> jupiter-api
- `/docs` -> Spring static docs
- WebSocket upgrade header 지원
