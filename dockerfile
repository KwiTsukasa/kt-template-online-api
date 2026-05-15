# 引用 Node 22 官方 Debian slim 镜像，避免非官方 tag 在镜像源里解析失败
FROM node:22-bookworm-slim

# 指定工作目录
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 缓存加速依赖安装
COPY package.json pnpm-lock.yaml ./

# 项目使用 pnpm-lock.yaml，镜像内也统一使用 pnpm 安装依赖
RUN corepack enable \
  && corepack prepare pnpm@9 --activate \
  && pnpm install --frozen-lockfile

# 拷贝业务代码
COPY . .

# 声明暴露端口号
EXPOSE 48085

CMD ["pnpm", "run", "start:prod"]
