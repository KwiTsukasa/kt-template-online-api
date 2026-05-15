# Jenkins Agent 镜像

这个目录只负责提供 NAS 上创建 Jenkins Agent 所需的镜像和启动说明。Jenkinsfile 只做 CI，不再创建或更新 Agent 节点。

Agent 镜像内置：

- Jenkins inbound agent
- Git / OpenSSH client
- Node.js 22
- pnpm 9
- Docker CLI / Buildx / Compose plugin

项目业务镜像仍然使用仓库根目录的 `dockerfile`。本目录的 Dockerfile 是给 Jenkins Agent 用的，不是后端服务运行镜像。

## Jenkins 侧配置

在 Jenkins 页面手动创建节点：

```text
Manage Jenkins -> Nodes -> New Node
Node name: kt-node-agent
Type: Permanent Agent
Remote root directory: /home/jenkins/agent
Labels: kt-node-agent nodejs docker
Usage: Only build jobs with label expressions matching this node
Launch method: Launch agent by connecting it to the controller
```

保存后进入节点页面，复制 inbound agent 的 `secret`。Jenkinsfile 会通过下面的标签调度到这个节点：

```groovy
agent { label 'kt-node-agent' }
```

## NAS 侧构建镜像

在 NAS 上准备 Docker 环境，然后从仓库根目录执行：

```bash
docker build -t kt-jenkins-agent:node22 -f ci/jenkins-agent/Dockerfile ci/jenkins-agent
```

## NAS 侧启动 Agent

如果 Jenkins Controller 容器名是 `jenkins`，并且你希望 Agent 通过 Docker 网络访问 Jenkins，可以先准备网络：

```bash
docker network create jenkins
docker network connect jenkins jenkins
```

启动 Agent 容器。你的 Jenkins Controller compose 暴露的是 `18080:8080`，如果 Agent 和 Jenkins 在同一个 Docker 网络，容器内仍然使用 `http://jenkins:8080/`；如果 Agent 不在同一个网络，使用 NAS/服务器可访问地址，例如 `http://Jenkins服务器IP:18080/`。

```bash
docker run -d \
  --name kt-node-agent \
  --restart=always \
  --network jenkins \
  -u root \
  -e JENKINS_URL=http://jenkins:8080/ \
  -e JENKINS_AGENT_NAME=kt-node-agent \
  -e JENKINS_SECRET=替换成节点页面里的secret \
  -e JENKINS_AGENT_WORKDIR=/home/jenkins/agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v kt-node-agent-workdir:/home/jenkins/agent \
  kt-jenkins-agent:node22
```

如果 Jenkins Controller 不在同一台 NAS 上，把 `JENKINS_URL` 改成 Agent 容器可访问的 Jenkins 地址，例如：

```bash
-e JENKINS_URL=http://192.168.1.10:18080/
```

如果 NAS 上的 Agent 需要执行 `docker build`，保留 `/var/run/docker.sock` 挂载。这个挂载等同于让 Agent 拥有 NAS Docker 控制权限，只建议放在可信内网环境。

## 验证

查看 Agent 日志：

```bash
docker logs -f kt-node-agent
```

Jenkins 页面确认节点在线：

```text
Manage Jenkins -> Nodes -> kt-node-agent
```

节点在线后，多分支流水线点击构建即可进入 CI 阶段。
