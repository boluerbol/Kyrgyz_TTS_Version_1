#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is required" >&2
  exit 1
fi

echo "[deploy] branch: ${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "[deploy] building and starting containers"
docker compose up --build -d

echo "[deploy] current service status"
docker compose ps

echo "[deploy] app health"
if command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:8000/health || true
  echo
else
  echo "curl not found; skipping health curl"
fi
