# Cloudflare を使わずに Tsumu を動かすためのイメージ（Node.js + SQLite + ファイル保存）。
# 編集データとアセットは /data に保存するので、ボリュームをつないで使う:
#   docker build -t tsumu .
#   docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu

FROM node:26.12.1-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@12.2.1 && npm ci
COPY . .
RUN NEXT_OUTPUT=standalone npm run build

FROM node:26.12.1-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TSUMU_DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
# DSA-6613-1: Debian Trixie fixes zlib heap overflow vulnerabilities.
# Upgrade only this OS package in the runtime image; keep Node pinned by digest.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
