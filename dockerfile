# 引用基础镜像
FROM node:22.14.0-release

# 指定工作目录
WORKDIR /app

# 拷贝文件
COPY . .

# 安装依赖
RUN npm install

RUN npm install pm2 -g

# # 声明暴露端口号
EXPOSE 48085

CMD npm run start:prod

