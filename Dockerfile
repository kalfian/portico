# syntax=docker/dockerfile:1

# ---- build stage: install prod deps (compiles better-sqlite3 if no prebuilt) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public

# ---- runtime stage: slim image, non-root, no build tools ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/topology.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
# global fetch is available on node 22
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
