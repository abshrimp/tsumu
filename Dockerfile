# Cloudflare を使わずに Tsumu を動かすためのイメージ（Node.js + SQLite + ファイル保存）。
# 編集データとアセットは /data に保存するので、ボリュームをつないで使う:
#   docker build -t tsumu .
#   docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu

FROM node:26.12.1-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@12.2.1 && npm ci
COPY . .
RUN NEXT_OUTPUT=standalone npm run build

FROM node:26.12.1-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TSUMU_DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
