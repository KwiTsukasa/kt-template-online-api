# fnOS Docker + Jenkins + k3d/K8s 标准发布流程

这套流程把飞牛 NAS 上的 Docker 保留为基础控制面，把业务运行逐步迁到 k3d/K3s：

- Jenkins Controller、Jenkins Agent、本地 Registry 仍由 Docker 管理。
- 后端 API 进入 k3d/K8s，由 Jenkins 构建镜像、推送本地 Registry、滚动更新 Deployment。
- Web 和 Playground 继续走现有 Nginx 静态发布，等后端链路稳定后再决定是否容器化。

## 固定命名

| 对象 | 名称 |
| --- | --- |
| Jenkins Agent | `kt-node-agent` |
| k3d 集群 | `kt-nas` |
| K8s namespace | `kt-prod` |
| 本地 Registry | `k3d-kt-registry.localhost:5000` |
| API Deployment | `kt-template-online-api` |
| API Service | `kt-template-online-api` |
| API K8s 容器名 | `api` |
| API 容器端口 | `48085` |
| API NodePort | `30085` |
| NAS 对外端口 | `48085` |

## 一次性初始化

先确保本机 SSH key 已授权到 NAS 的 root 用户，然后从仓库根目录执行：

```powershell
.\ci\fnos-k8s\run-remote-bootstrap.ps1
```

如果 NAS 上旧的 Docker API 容器已经占用 `48085`，第一次真正切换时再执行：

```powershell
.\ci\fnos-k8s\run-remote-bootstrap.ps1 -Cutover
```

`-Cutover` 会允许脚本停止旧的 `kt-template-online-api` Docker 容器，把 `48085` 交给 k3d loadbalancer 映射到 K8s `NodePort 30085`。

脚本会在 NAS 上完成：

- 创建 `/vol1/docker/kt-k8s/{registry,kubeconfig,secrets,manifests,backups}`。
- 安装缺失的 `k3d` 和 `kubectl`。
- 创建本地 Registry。
- 创建 `kt-nas` 集群。
- 拉取并导入 `rancher/mirrored-pause:3.6`，避免 K3s 节点因 Docker Hub 超时卡在 `ContainerCreating`。
- 导出 host kubeconfig 和 Jenkins Agent kubeconfig。
- 创建 `kt-prod` namespace。
- 将 `kt-node-agent` 接入 k3d Docker 网络。
- 将 kubeconfig 复制到 Agent 内的 `/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml`。
- 如果 Agent 内已有 `/home/jenkins/agent/env/kt-template-online-api/.env.production`，同步创建 `kt-template-online-api-env` Secret。

## Jenkins Agent 镜像

Agent 镜像位于：

```text
ci/jenkins-agent/Dockerfile
```

镜像内置：

- Node.js 22
- pnpm 9
- Docker CLI / Buildx / Compose
- kubectl
- Git / OpenSSH

NAS 上重新构建并重启 Agent：

```bash
docker build -t kt-jenkins-agent:node22 -f ci/jenkins-agent/Dockerfile ci/jenkins-agent
docker rm -f kt-node-agent
```

然后按 `ci/jenkins-agent/README.md` 中的 `docker run` 命令重新启动。Agent 启动后再跑一次：

```powershell
.\ci\fnos-k8s\run-remote-bootstrap.ps1
```

这样脚本会把 kubeconfig 重新复制进 Agent，并把 Agent 接到 `k3d-kt-nas` 网络。

## Jenkins 发布参数

后端 Jenkinsfile 的标准参数：

```text
DEPLOY_TARGET=k8s
BUILD_DOCKER_IMAGE=true
PUSH_DOCKER_IMAGE=true
DOCKER_REGISTRY=k3d-kt-registry.localhost:5000
IMAGE_NAME=kt-template-online-api
CONTAINER_ENV_FILE=/home/jenkins/agent/env/kt-template-online-api/.env.production
KUBE_CONFIG_FILE=/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml
K8S_MANIFEST_FILE=k8s/prod/api.yaml
K8S_NAMESPACE=kt-prod
K8S_DEPLOYMENT=kt-template-online-api
K8S_CONTAINER=api
K8S_ENV_SECRET=kt-template-online-api-env
```

发布阶段会做四件事：

1. 构建后端 `dist`。
2. 用仓库根目录 `dockerfile` 构建业务镜像。
3. 推送到 NAS 本地 Registry，同时更新 `latest` 标签。
4. 从 Agent 私有 `.env.production` 重建 K8s Secret，并滚动更新 Deployment 镜像。

## 验证

NAS 上验证集群：

```bash
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml get nodes
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml -n kt-prod get pod,svc
```

Agent 内验证：

```bash
docker exec kt-node-agent sh -lc 'kubectl --kubeconfig /home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml -n kt-prod get pod,svc'
```

API 验证：

```bash
curl -I http://127.0.0.1:48085
```

如果公网入口仍由腾讯云 WireGuard/Caddy 转发到 NAS `10.66.66.2:48085`，切换到 K8s 后公网侧不需要改端口。

## 回滚

查看发布历史：

```bash
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml -n kt-prod rollout history deployment/kt-template-online-api
```

回滚上一个版本：

```bash
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml -n kt-prod rollout undo deployment/kt-template-online-api
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml -n kt-prod rollout status deployment/kt-template-online-api --timeout=180s
```

查看日志：

```bash
kubectl --kubeconfig /vol1/docker/kt-k8s/kubeconfig/kt-nas.host.yaml -n kt-prod logs -l app=kt-template-online-api --tail=200
```

如果需要临时退回旧 Docker 容器，先删除或停止 k3d loadbalancer 对 `48085` 的占用，再按旧 Jenkins Docker 参数重启 `kt-template-online-api` 容器。

## 参考

- k3d: <https://k3d.io/stable/>
- k3d Registry: <https://k3d.io/stable/usage/registries/>
- kubectl Linux 安装: <https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/>
- Kubernetes Deployment: <https://kubernetes.io/docs/concepts/workloads/controllers/deployment/>
