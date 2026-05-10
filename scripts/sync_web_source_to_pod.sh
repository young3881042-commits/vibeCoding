#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${WEB_DIR:-$ROOT_DIR/apps/web}"
KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
NAMESPACE="${KUBE_NAMESPACE:-jupiter}"
POD_SELECTOR="${POD_SELECTOR:-app=jupiter-web}"
GIT_PULL="${GIT_PULL:-0}"
RUN_NPM_INSTALL="${RUN_NPM_INSTALL:-0}"

if [[ "$GIT_PULL" == "1" ]]; then
  echo "[web-sync] git pull --ff-only"
  git -C "$ROOT_DIR" pull --ff-only
fi

echo "[web-sync] ready pod 대기: $POD_SELECTOR"
"$KUBECTL_BIN" -n "$NAMESPACE" wait pod -l "$POD_SELECTOR" --for=condition=Ready --timeout=120s >/dev/null

POD="$("$KUBECTL_BIN" -n "$NAMESPACE" get pod -l "$POD_SELECTOR" \
  -o jsonpath='{.items[0].metadata.name}')"

if [[ -z "$POD" ]]; then
  echo "[web-sync] 대상 pod를 찾지 못했습니다: namespace=$NAMESPACE selector=$POD_SELECTOR" >&2
  exit 1
fi

files=(index.html vite.config.js package.json package-lock.json src)
if [[ -d "$WEB_DIR/public" ]]; then
  files+=(public)
fi

echo "[web-sync] source sync: $WEB_DIR -> $NAMESPACE/$POD:/workspace"
"$KUBECTL_BIN" -n "$NAMESPACE" exec "$POD" -- sh -lc 'mkdir -p /workspace && rm -rf /workspace/src /workspace/public'
tar -C "$WEB_DIR" -cf - "${files[@]}" | "$KUBECTL_BIN" -n "$NAMESPACE" exec -i "$POD" -- tar -xf - -C /workspace

if [[ "$RUN_NPM_INSTALL" == "1" ]]; then
  echo "[web-sync] npm install in pod"
  "$KUBECTL_BIN" -n "$NAMESPACE" exec "$POD" -- sh -lc 'cd /workspace && npm install'
fi

echo "[web-sync] 완료: http://192.168.45.101:31088"
