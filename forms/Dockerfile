FROM node:22-alpine
WORKDIR /app
COPY server.mjs lib.mjs ./
ENV NODE_ENV=production PORT=5100 SITES_FILE=/config/sites.json DATA_DIR=/data
EXPOSE 5100
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:5100/healthz || exit 1
CMD ["node", "server.mjs"]
