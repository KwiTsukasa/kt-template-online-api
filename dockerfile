FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
ENV APP_PORT=48085
ENV LOG_LEVEL=info
ENV LOG_APP_NAME=kt-template-online-api
ENV LOG_PRETTY=false
ENV LOKI_ENV=production
ENV LOKI_PUSH_ENDPOINT=/loki/api/v1/push
ENV LOKI_QUERY_ENDPOINT=/loki/api/v1/query_range
ENV LOKI_PUSH_TIMEOUT_MS=30000
ENV LOKI_QUERY_TIMEOUT_MS=10000
ENV LOKI_BATCH_INTERVAL_SECONDS=5
ENV LOKI_BATCH_MAX_BUFFER_SIZE=10000
ENV LOKI_QUERY_MAX_LIMIT=1000
ENV LOKI_SILENCE_ERRORS=true
ENV FFLOGS_BASE_URL=https://cn.fflogs.com
ENV FFLOGS_WEB_BASE_URL=https://cn.fflogs.com
ENV FFLOGS_GRAPHQL_URL=https://cn.fflogs.com/api/v2/client
ENV FFLOGS_TOKEN_URL=https://cn.fflogs.com/oauth/token
ENV FFLOGS_DEFAULT_SERVER_REGION=CN
ENV FFLOGS_REQUEST_TIMEOUT_MS=10000

COPY package.json pnpm-lock.yaml ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk openssh-client \
  && rm -rf /var/lib/apt/lists/*

# 生产镜像只安装运行依赖，dist 由 Jenkins Build stage 提前产出。
# 跳过安装阶段脚本，避免 NODE_ENV=production 时 devDependency 中的 husky 不存在导致 prepare 失败。
RUN corepack enable \
  && corepack prepare pnpm@9 --activate \
  && pnpm install --prod --frozen-lockfile --ignore-scripts \
  && pnpm rebuild skia-canvas

# dist 由 Jenkins 的 Build stage 生成，这里只打包运行产物。
COPY dist ./dist

EXPOSE 48085

CMD ["node", "dist/main"]
