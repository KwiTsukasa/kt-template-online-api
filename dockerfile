FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./

# 生产镜像只安装运行依赖，dist 由 Jenkins Build stage 提前产出。
RUN corepack enable \
  && corepack prepare pnpm@9 --activate \
  && pnpm install --prod --frozen-lockfile

# dist 由 Jenkins 的 Build stage 生成，这里只打包运行产物。
COPY dist ./dist

EXPOSE 48085

CMD ["node", "dist/main"]
