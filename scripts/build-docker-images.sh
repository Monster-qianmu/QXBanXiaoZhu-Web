#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker 命令。请先安装并启动 Docker，或在 N1 上执行本脚本。" >&2
  exit 127
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon 不可用。请确认 Docker Desktop/服务已启动。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未找到 docker compose 插件。请安装 Docker Compose v2。" >&2
  exit 1
fi

export QXBAN_PLATFORM="${QXBAN_PLATFORM:-linux/arm64}"
export QXBAN_BACKEND_IMAGE="${QXBAN_BACKEND_IMAGE:-qxbanxiaozhu-backend:latest}"
export QXBAN_FRONTEND_IMAGE="${QXBAN_FRONTEND_IMAGE:-qxbanxiaozhu-frontend:latest}"

docker compose build

docker image inspect "$QXBAN_BACKEND_IMAGE" "$QXBAN_FRONTEND_IMAGE" \
  --format '{{index .RepoTags 0}} {{.Id}} {{.Size}}'

if [[ "${1:-}" == "--save" ]]; then
  mkdir -p dist/docker
  platform_name="${QXBAN_PLATFORM//\//-}"
  output_path="${2:-dist/docker/qxbanxiaozhu-images-${platform_name}.tar}"
  docker save "$QXBAN_BACKEND_IMAGE" "$QXBAN_FRONTEND_IMAGE" -o "$output_path"
  echo "已导出镜像包：$output_path"
fi
