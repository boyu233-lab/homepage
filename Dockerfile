# =========================
# Builder Stage
# =========================
FROM node:24-slim AS builder
WORKDIR /app

# Setup
RUN mkdir config
COPY . .

ARG CI
ARG BUILDTIME
ARG VERSION
ARG REVISION
ENV CI=$CI

# Install and build only outside CI
RUN if [ "$CI" != "true" ]; then \
      corepack enable && corepack prepare pnpm@latest --activate && \
      pnpm install --frozen-lockfile --prefer-offline && \
      NEXT_TELEMETRY_DISABLED=1 \
      NEXT_PUBLIC_BUILDTIME=$BUILDTIME \
      NEXT_PUBLIC_VERSION=$VERSION \
      NEXT_PUBLIC_REVISION=$REVISION \
      pnpm run build; \
    else \
      echo "✅ Using prebuilt app from CI context"; \
    fi

# =========================
# Runtime Stage
# =========================
FROM node:24-alpine AS runner
LABEL org.opencontainers.image.title="Homepage"
LABEL org.opencontainers.image.description="A self-hosted services landing page, with docker and service integrations."
LABEL org.opencontainers.image.url="https://github.com/gethomepage/homepage"
LABEL org.opencontainers.image.documentation='https://github.com/gethomepage/homepage/wiki'
LABEL org.opencontainers.image.source='https://github.com/gethomepage/homepage'
LABEL org.opencontainers.image.licenses='Apache-2.0'

# Setup
WORKDIR /app

# Copy some files from context
COPY --link --chown=1000:1000 /public ./public/
# 始终在 Linux 侧剥掉 CR：Windows 检出（core.autocrlf=true）会把 .sh 变成
# CRLF，shebang 变成 #!/bin/sh\r 会导致容器启动时 exec 报 "no such file or directory"。
COPY --link docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN tr -d '\r' < /usr/local/bin/docker-entrypoint.sh > /tmp/entrypoint.sh \
 && mv /tmp/entrypoint.sh /usr/local/bin/docker-entrypoint.sh \
 && chmod 755 /usr/local/bin/docker-entrypoint.sh

# Copy only necessary files from the build stage
COPY --link --from=builder --chown=1000:1000 /app/.next/standalone/ ./
COPY --link --from=builder --chown=1000:1000 /app/.next/static/ ./.next/static

# Fork 定制配置（已脱敏）覆盖 standalone 自带的官方 skeleton：
# 配置目录为空时，应用会自动拷贝这份，直接带上在线壁纸、分组导航与极光主题。
COPY --link --chown=1000:1000 /src/skeleton/ ./src/skeleton/
# 官方原版 skeleton 指纹，供入口脚本识别「用户未修改过的默认配置」。
COPY --link --chown=1000:1000 /deploy/skeleton-official/ ./skeleton-official/

RUN apk add --no-cache su-exec iputils-ping shadow

USER root

ENV NODE_ENV=production
ENV HOSTNAME=::
ENV PORT=3000
EXPOSE $PORT

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget --no-verbose --tries=1 --spider -Y off http://127.0.0.1:$PORT/api/healthcheck || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
