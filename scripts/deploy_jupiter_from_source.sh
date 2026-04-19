#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

NAMESPACE="${KUBE_NAMESPACE:-jupiter}"
API_SECRET="${API_SECRET:-jupiter-api-source}"
WEB_SECRET="${WEB_SECRET:-jupiter-frontend-archive-source}"
API_DEPLOYMENT="${API_DEPLOYMENT:-jupiter-api}"
WEB_DEPLOYMENT="${WEB_DEPLOYMENT:-jupiter-web}"

API_ARCHIVE="$TMP_DIR/jupiter-api-source.tar.gz"
WEB_ARCHIVE="$TMP_DIR/jupiter-web-source.tar.gz"

echo "[deploy] API 소스 아카이브 생성"
tar -czf "$API_ARCHIVE" -C "$ROOT_DIR/apps/api" .

echo "[deploy] Web 소스 아카이브 생성"
tar -czf "$WEB_ARCHIVE" \
  --exclude=node_modules \
  --exclude=dist \
  -C "$ROOT_DIR/apps/web" .

echo "[deploy] API source secret 갱신"
kubectl -n "$NAMESPACE" create secret generic "$API_SECRET" \
  --from-file=source.tar.gz="$API_ARCHIVE" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[deploy] Web source secret 갱신"
kubectl -n "$NAMESPACE" create secret generic "$WEB_SECRET" \
  --from-file=source.tar.gz="$WEB_ARCHIVE" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[deploy] API rollout restart"
kubectl -n "$NAMESPACE" rollout restart "deploy/$API_DEPLOYMENT"

echo "[deploy] Web rollout restart"
kubectl -n "$NAMESPACE" rollout restart "deploy/$WEB_DEPLOYMENT"

echo "[deploy] API rollout 대기"
kubectl -n "$NAMESPACE" rollout status "deploy/$API_DEPLOYMENT" --timeout=240s

echo "[deploy] Web rollout 대기"
kubectl -n "$NAMESPACE" rollout status "deploy/$WEB_DEPLOYMENT" --timeout=240s

echo "[deploy] 완료"
