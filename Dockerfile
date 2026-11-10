# ---- 1. Build the web app ----
FROM node:26-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
# Packages' own install scripts are a common way in for a hijacked package, so they're off;
# only esbuild (the bundler, which needs its platform binary) is allowed to set itself up.
RUN npm install --no-audit --no-fund --ignore-scripts && npm rebuild esbuild
COPY web/ ./
RUN npm run build

# ---- 2. Install server dependencies (better-sqlite3 may need to compile) ----
FROM node:26-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
# Install scripts off for everything except the database driver, which compiles native code.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && npm rebuild better-sqlite3

# ---- 3. Runtime ----
FROM node:26-bookworm-slim
# Changes weekly (deploy/install.sh), so Debian's security updates are picked up even when
# nothing else in the image changed.
ARG SECURITY_REFRESH=0
RUN echo "security refresh $SECURITY_REFRESH" && apt-get update && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ffmpeg poppler-utils libheif-examples tzdata ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY --from=web /web/dist /app/web/dist
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
