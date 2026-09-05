# Jenkins Agent 镜像

本目录提供 Jenkins inbound Agent 的镜像；业务 API 镜像使用仓库根 `dockerfile`。Jenkinsfile 不创建或更新 Agent 节点。

镜像包含 Git/OpenSSH、Node.js 22、pnpm 9、Docker CLI/Buildx/Compose 和 kubectl。镜像构建入口为同目录 `Dockerfile`，节点配置、工作目录和回滚说明集中在 [中央维护文档](../../../../docs/projects/api/reference/jenkins-agent.md)。

Agent 连接凭据由 Jenkins 私有配置提供，不写入镜像、仓库或文档。
