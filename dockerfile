FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client \
  && rm -rf /var/lib/apt/lists/*

# 生产镜像只安装运行依赖，dist 由 Jenkins Build stage 提前产出。
# 跳过安装阶段脚本，避免 NODE_ENV=production 时 devDependency 中的 husky 不存在导致 prepare 失败。
RUN corepack enable \
  && corepack prepare pnpm@9 --activate \
  && pnpm install --prod --frozen-lockfile --ignore-scripts

# dist 由 Jenkins 的 Build stage 生成，这里只打包运行产物。
COPY dist ./dist

EXPOSE 48085

CMD ["node", "dist/main"]
