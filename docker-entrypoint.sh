#!/bin/sh

set -e

# Default to root, so old installations won't break
export PUID=${PUID:-0}
export PGID=${PGID:-0}

# This is in attempt to preserve the original behavior of the Dockerfile,
# while also supporting the lscr.io /config directory
[ ! -d "/app/config" ] && ln -s /config /app/config

export HOMEPAGE_BUILDTIME=$(date +%s)

# Try IPv6 first (dual stack when available), but fall back to IPv4 if the bind fails
export HOSTNAME=${HOSTNAME:-::}
if [ "$HOSTNAME" = "::" ]; then
  if ! node -e "const server = require('http').createServer(() => {}); const host = '::'; const port = process.env.PORT || 3000; server.once('error', (err) => { console.error('IPv6 bind failed:', err.message); process.exit(1); }); server.listen(port, host, () => server.close(() => process.exit(0)));"; then
    echo "Falling back to IPv4 bind at 0.0.0.0"
    export HOSTNAME=0.0.0.0
  fi
fi

# Check ownership before chown
if [ "$PUID" = "0" ]; then
  echo "Skipping ownership changes for /app/config"
elif [ -e /app/config ]; then
  CURRENT_UID=$(stat -c %u /app/config)
  CURRENT_GID=$(stat -c %g /app/config)

  if [ "$CURRENT_UID" -ne "$PUID" ] || [ "$CURRENT_GID" -ne "$PGID" ]; then
    echo "Fixing ownership of /app/config"
    if ! chown -R "$PUID:$PGID" /app/config 2>/dev/null; then
      echo "Warning: Could not chown /app/config; continuing anyway"
    fi
  else
    echo "/app/config already owned by correct UID/GID, skipping chown"
  fi
else
  echo "/app/config does not exist; skipping ownership check"
fi

# Ensure /app/config/logs exists and is owned
if [ "$PUID" = "0" ]; then
  echo "Skipping ownership changes for /app/config/logs"
elif [ -n "$PUID" ] && [ -n "$PGID" ]; then
  mkdir -p /app/config/logs 2>/dev/null || true
  if [ -d /app/config/logs ]; then
    LOG_UID=$(stat -c %u /app/config/logs)
    LOG_GID=$(stat -c %g /app/config/logs)
    if [ "$LOG_UID" -ne "$PUID" ] || [ "$LOG_GID" -ne "$PGID" ]; then
      echo "Fixing ownership of /app/config/logs"
      chown -R "$PUID:$PGID" /app/config/logs 2>/dev/null || echo "Warning: Could not chown /app/config/logs"
    fi
  fi
fi

if [ -d /app/.next ]; then
  CURRENT_UID=$(stat -c %u /app/.next)
  CURRENT_GID=$(stat -c %g /app/.next)

  if [ "$PUID" -ne 0 ] && ([ "$CURRENT_UID" -ne "$PUID" ] || [ "$CURRENT_GID" -ne "$PGID" ]); then
    echo "Fixing ownership of /app/.next"
    if ! chown -R "$PUID:$PGID" /app/.next 2>/dev/null; then
      echo "Warning: Could not chown /app/.next; continuing anyway"
    fi
  else
    echo "/app/.next already owned by correct UID/GID or running as root, skipping chown"
  fi
fi

# 历史兼容：早期镜像的 skeleton 里 custom.js / custom.css 是 0 字节，其余为官方默认，
# 已被拷进持久化配置目录。仅在配置缺失、为空、或与官方默认逐字节一致时用内置定制版补齐；
# 用户自己编辑过的非空配置一律不动（包括自己的 bookmarks.yaml）。
CONFIG_DIR=${HOMEPAGE_CONFIG_DIR:-/app/config}
DEFAULTS=/app/src/skeleton
BASELINE=/app/skeleton-official

if [ -d "$DEFAULTS" ] && [ -d "$CONFIG_DIR" ]; then
  for f in custom.js custom.css settings.yaml services.yaml widgets.yaml bookmarks.yaml; do
    src="$DEFAULTS/$f"
    dst="$CONFIG_DIR/$f"
    [ -f "$src" ] || continue
    apply=0
    if [ ! -e "$dst" ] || [ ! -s "$dst" ]; then
      apply=1
    elif [ -f "$BASELINE/$f" ] && cmp -s "$dst" "$BASELINE/$f"; then
      apply=1
    fi
    if [ "$apply" = 1 ]; then
      if cp "$src" "$dst" 2>/dev/null; then
        chown "$PUID:$PGID" "$dst" 2>/dev/null || true
        echo "Applied bundled default: $f"
      else
        echo "Warning: Could not apply bundled default for $f"
      fi
    fi
  done
fi

# Drop privileges (when asked to) if root, otherwise run as current user
if [ "$(id -u)" = "0" ] && [ "${PUID}" != "0" ]; then
  exec su-exec ${PUID}:${PGID} "$@"
else
  exec "$@"
fi
