#!/usr/bin/env bash
# 本机构建 Homepage fork 镜像并推送 Docker Hub（GitHub Actions 之外的备选路径）。
#
# 前置条件：
#   1) Docker Desktop / daemon 正在运行
#   2) 能访问 Docker Hub（国内通常需要开代理；daemon 代理要在 Docker Desktop 设置里配，
#      或给 docker build 传 --build-arg HTTP_PROXY=... 指向 host.docker.internal）
#   3) 已 `docker login`，或设置 DOCKERHUB_USERNAME + DOCKERHUB_TOKEN（Access Token）
#
# 用法：
#   DOCKERHUB_IMAGE=你的用户名/homepage-bookmark-manager ./deploy/build-and-push.sh
#   IMAGE_TAG=2026.11.05 ./deploy/build-and-push.sh
#   国内网络构建失败（corepack 拉不到 pnpm）时加：
#   PNPM_REGISTRY=https://registry.npmmirror.com DOCKERHUB_IMAGE=... ./deploy/build-and-push.sh
#
# 更省事的做法：用 .github/workflows/docker-publish-fork.yml 在云端构建，无需本机 Docker。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${DOCKERHUB_IMAGE:-}"
TAG="${IMAGE_TAG:-latest}"
SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"

if [ -z "$IMAGE" ]; then
  echo "请设置 DOCKERHUB_IMAGE，例如：DOCKERHUB_IMAGE=yourname/homepage-bookmark-manager $0" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon 不可达，请先启动 Docker Desktop" >&2
  exit 1
fi

echo "镜像: ${IMAGE}:${TAG} (另打 sha-${SHA})"
echo "上下文: ${REPO_ROOT}"

# 用 Access Token 非交互登录（若已 docker login 可跳过）
if [ -n "${DOCKERHUB_TOKEN:-}" ] && [ -n "${DOCKERHUB_USERNAME:-}" ]; then
  printf '%s' "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
fi

BUILD_ARGS=(
  --build-arg "BUILDTIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  --build-arg "VERSION=${TAG}"
  --build-arg "REVISION=${SHA}"
)

if [ -n "${PNPM_REGISTRY:-}" ]; then
  BUILD_ARGS+=(--build-arg "PNPM_REGISTRY=${PNPM_REGISTRY}")
  echo "npm 镜像源: ${PNPM_REGISTRY}"
fi

# Docker Desktop 会把宿主机代理注入构建容器，而 127.0.0.1 在容器内指向容器自身，
# 代理软件没开时会出现 ECONNREFUSED 127.0.0.1:xxxx。设 NO_BUILD_PROXY=1 清空全部代理变量，
# 让构建容器直连（配合 PNPM_REGISTRY=https://registry.npmmirror.com 效果最好）。
if [ "${NO_BUILD_PROXY:-0}" = "1" ]; then
  for var in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
    BUILD_ARGS+=(--build-arg "${var}=")
  done
  echo "构建容器代理: 已清空（直连）"
else
  # 容器内如需走代理，把宿主机代理变量透传（注意 127.0.0.1 在容器内指向容器本身）
  for var in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
    if [ -n "${!var:-}" ]; then
      BUILD_ARGS+=(--build-arg "${var}=${!var}")
    fi
  done
fi

docker build "${BUILD_ARGS[@]}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:sha-${SHA}" \
  "$REPO_ROOT"

docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:sha-${SHA}"

echo "✅ 已推送 ${IMAGE}:${TAG} 与 ${IMAGE}:sha-${SHA}"
