# Jenkins Agent 镜像

这个目录只负责提供 NAS 上创建 Jenkins Agent 所需的镜像和启动说明。Jenkinsfile 只做 CI，不再创建或更新 Agent 节点。

Agent 镜像内置：

- Jenkins inbound agent
- Git / OpenSSH client
- Node.js 22
- pnpm 9
- Docker CLI / Buildx / Compose plugin
- kubectl
- `github.com` SSH known_hosts

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

如果 Git 仓库不是 GitHub，可以在构建时覆盖 SSH host：

```bash
docker build \
  --build-arg GIT_SSH_HOST=你的Git服务器域名 \
  -t kt-jenkins-agent:node22 \
  -f ci/jenkins-agent/Dockerfile \
  ci/jenkins-agent
```

## NAS 侧启动 Agent

如果 Jenkins Controller 使用你当前的 compose 启动，默认网络是 `jenkins_default`。先确认网络存在：

```bash
docker network ls | grep jenkins_default
```

启动 Agent 容器。你的 Jenkins Controller compose 暴露的是 `18080:8080`，如果 Agent 和 Jenkins 在同一个 Docker 网络，容器内仍然使用 `http://jenkins:8080/`；如果 Agent 不在同一个网络，使用 NAS/服务器可访问地址，例如 `http://Jenkins服务器IP:18080/`。

```bash
docker run -d \
  --name kt-node-agent \
  --restart=always \
  --network jenkins_default \
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

## 业务容器 env 文件

Jenkinsfile 的 `Docker Run` 阶段默认会读取 Agent 容器内的：

```text
/home/jenkins/agent/env/kt-template-online-api/.env.production
```

这个路径在已有的 `kt-node-agent-workdir` volume 里，不需要为了 env 文件重新创建 Agent 容器。先在 Agent 容器内创建目录：

```bash
docker exec kt-node-agent sh -lc 'mkdir -p /home/jenkins/agent/env/kt-template-online-api'
```

如果 NAS 上已有 env 文件，可以复制进 Agent workdir：

```bash
docker cp /你的NAS路径/.env.production kt-node-agent:/home/jenkins/agent/env/kt-template-online-api/.env.production
docker exec kt-node-agent sh -lc 'chmod 600 /home/jenkins/agent/env/kt-template-online-api/.env.production'
```

复制后确认 Jenkinsfile 能读取到：

```bash
docker exec kt-node-agent sh -lc 'ls -l /home/jenkins/agent/env/kt-template-online-api/.env.production'
```

多分支流水线构建时保持默认参数即可：

```text
RUN_DOCKER_CONTAINER=true
CONTAINER_NAME=kt-template-online-api
CONTAINER_PORT=48085
CONTAINER_ENV_FILE=/home/jenkins/agent/env/kt-template-online-api/.env.production
```

如果业务容器需要加入某个 Docker 网络，在 Jenkins 参数 `CONTAINER_NETWORK` 填网络名；如果需要挂载上传目录、日志目录等，在 `CONTAINER_EXTRA_ARGS` 填额外的 `docker run` 参数。

## K8s 发布 kubeconfig

标准 K8s 发布链路使用 `ci/fnos-k8s/bootstrap.sh` 在 NAS 上创建 k3d 集群，并把 Jenkins Agent 专用 kubeconfig 放入：

```text
/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml
```

这个 kubeconfig 的 API Server 地址是 k3d Docker 网络内的：

```text
https://k3d-kt-nas-serverlb:6443
```

因此 Agent 容器需要同时加入 Jenkins 网络和 k3d 网络。初始化脚本会自动执行：

```bash
docker network connect k3d-kt-nas kt-node-agent
```

如果重建了 Agent 容器，重新执行一次下面命令即可恢复 kubeconfig 和网络连接：

```powershell
.\ci\fnos-k8s\run-remote-bootstrap.ps1
```

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

## 常见问题

如果 Jenkins checkout 时报错：

```text
No ED25519 host key is known for github.com
Host key verification failed.
```

说明 Agent 容器缺少 Git 服务器的 SSH host key。当前 Dockerfile 已在镜像构建时写入 `github.com` 的用户级 `known_hosts` 和系统级 `/etc/ssh/ssh_known_hosts`。重新构建镜像并重启 Agent：

```bash
docker build --no-cache -t kt-jenkins-agent:node22 -f ci/jenkins-agent/Dockerfile ci/jenkins-agent
docker rm -f kt-node-agent
```

然后按上面的 `docker run` 命令重新启动 Agent。

重启后可以先检查容器里是否已经写入 GitHub host key：

```bash
docker exec kt-node-agent sh -lc 'ssh-keygen -F github.com -f /etc/ssh/ssh_known_hosts && ssh-keygen -F github.com -f /root/.ssh/known_hosts'
```

如果仍然报同样错误，去 Jenkins 页面把 Git Host Key Verification 改成手动提供或首次接受：

```text
Manage Jenkins -> Security -> Git Host Key Verification Configuration
```

推荐先选 `Accept first connection strategy` 验证链路；更严格的做法是选手动提供 GitHub host keys。
