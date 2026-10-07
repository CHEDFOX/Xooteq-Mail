# Xooteq Mail: the web app is built once, then the server runs on Node's own
# TypeScript support (no compile step), as an unprivileged user.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=5200 DATA_DIR=/data WEB_DIR=/app/web/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5200/healthz >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
