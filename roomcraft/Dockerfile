# syntax=docker/dockerfile:1

# ── 빌드 ──────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 는 네이티브 모듈이라 빌드 도구가 필요합니다.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# 프로덕션 의존성만 남깁니다. 네이티브 모듈은 여기서 다시 빌드됩니다.
RUN npm prune --omit=dev

# ── 실행 ──────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# SQLite 파일이 놓일 볼륨 마운트 지점.
# 이 경로를 영속 볼륨에 연결하지 않으면 재배포마다 계정·크레딧이 사라집니다.
ENV DATABASE_PATH=/data/roomcraft.db
RUN mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json ./

USER node
EXPOSE 8787

# 헬스체크는 API 가 아니라 프로세스 생존만 보는 것으로는 부족합니다.
# DB 마이그레이션까지 끝나야 /api/health 가 200 을 돌려줍니다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
