#!/usr/bin/env bash
set -euo pipefail

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
NAMESPACE="${KUBE_NAMESPACE:-jupiter}"
API_SERVICE="${API_SERVICE:-jupiter-api}"
WEB_SERVICE="${WEB_SERVICE:-jupiter-web}"
QDRANT_SERVICE="${QDRANT_SERVICE:-qdrant}"

API_PORT="${API_PORT:-18080}"
WEB_PORT="${WEB_PORT:-15173}"
QDRANT_PORT="${QDRANT_PORT:-16333}"

API_LOG="$(mktemp)"
WEB_LOG="$(mktemp)"
QDRANT_LOG="$(mktemp)"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" >/dev/null 2>&1 || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" >/dev/null 2>&1 || true
  [[ -n "${QDRANT_PID:-}" ]] && kill "$QDRANT_PID" >/dev/null 2>&1 || true
  rm -f "$API_LOG" "$WEB_LOG" "$QDRANT_LOG"
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[smoke] ${name} 확인"
      return 0
    fi
    sleep 2
  done
  echo "[smoke] ${name} 확인 실패: ${url}" >&2
  return 1
}

echo "[smoke] API port-forward"
"$KUBECTL_BIN" -n "$NAMESPACE" port-forward "svc/$API_SERVICE" "${API_PORT}:8080" >"$API_LOG" 2>&1 &
API_PID=$!

echo "[smoke] Web port-forward"
"$KUBECTL_BIN" -n "$NAMESPACE" port-forward "svc/$WEB_SERVICE" "${WEB_PORT}:80" >"$WEB_LOG" 2>&1 &
WEB_PID=$!

echo "[smoke] Qdrant port-forward"
"$KUBECTL_BIN" -n "$NAMESPACE" port-forward "svc/$QDRANT_SERVICE" "${QDRANT_PORT}:6333" >"$QDRANT_LOG" 2>&1 &
QDRANT_PID=$!

sleep 5

wait_for_http "http://127.0.0.1:${API_PORT}/api/overview" "API overview"
curl -fsS "http://127.0.0.1:${API_PORT}/api/rag/weather" >/dev/null
echo "[smoke] RAG weather 확인"

wait_for_http "http://127.0.0.1:${WEB_PORT}" "Web root"
wait_for_http "http://127.0.0.1:${QDRANT_PORT}/collections" "Qdrant collections"

echo "[smoke] 완료"
