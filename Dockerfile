# SkinLab AI — 배포용 이미지
# 의존성이 거의 없어 빌드가 단순합니다. 그대로 두고 쓰셔도 됩니다.
FROM node:22-alpine

WORKDIR /app

# 의존성 먼저 설치 (코드가 바뀌어도 이 층은 재사용돼 배포가 빨라집니다)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# 데이터는 /data 에만 씁니다. 이 경로를 '디스크'로 붙여야 재배포해도 기록이 남습니다.
ENV NODE_ENV=production \
    PORT=8787 \
    SKINLAB_DB=/data/db.json \
    SKINLAB_CATALOG=/data/catalog.live.json

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
