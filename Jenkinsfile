def runCmd(String unixScript, String windowsScript = null) {
  if (isUnix()) {
    sh unixScript
  } else {
    bat(windowsScript ?: unixScript)
  }
}

def normalizeDockerTag(String value) {
  return value.replaceAll(/[^A-Za-z0-9_.-]/, '-')
}

def shellQuote(String value) {
  return "'" + (value ?: '').replace("'", "'\"'\"'") + "'"
}

def resolveSourceName(String branchName, String changeBranch, String changeId, String tagName) {
  if (changeId) {
    return changeBranch ?: "PR-${changeId}"
  }
  return tagName ?: branchName ?: 'local'
}

def isPublishBranch(String branchName, String pattern) {
  return branchName ==~ pattern
}

def requiredRuntimeEnvKeys() {
  return [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
    'ADMIN_TOKEN_SECRET',
    'WORDPRESS_BASE_URL',
    'FFLOGS_CLIENT_ID',
    'FFLOGS_CLIENT_SECRET',
  ]
}

def buildEnvFileValidationScript(String envFile) {
  def checks = requiredRuntimeEnvKeys().collect { key ->
    """
      if ! grep -Eq '^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]]+' "\$ENV_FILE"; then
        echo "Missing required runtime env key: ${key}"
        missing=1
      fi
    """.stripIndent()
  }.join('\n')

  return """
    set -e
    ENV_FILE=${shellQuote(envFile)}
    if [ ! -f "\$ENV_FILE" ]; then
      echo "Container env file not found: ${envFile}"
      exit 1
    fi
    missing=0
    ${checks}
    if [ "\$missing" -ne 0 ]; then
      echo "Update the private .env.production used by Jenkins before deploying."
      exit 1
    fi
  """.stripIndent()
}

pipeline {
  agent { label 'kt-node-agent' }

  options {
    skipDefaultCheckout(true)
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
  }

  parameters {
    choice(name: 'DEPLOY_TARGET', choices: ['k8s', 'docker', 'none'], description: '发布目标：k8s 为标准发布链路，docker 为旧容器替换链路，none 只做 CI 和镜像构建')
    booleanParam(name: 'BUILD_DOCKER_IMAGE', defaultValue: true, description: '是否在非 PR 分支使用项目现有 dockerfile 构建镜像')
    booleanParam(name: 'PUSH_DOCKER_IMAGE', defaultValue: true, description: '是否执行 docker push；K8s 发布会强制推送到本地 registry')
    booleanParam(name: 'RUN_DOCKER_CONTAINER', defaultValue: false, description: '旧 Docker 发布链路：镜像构建成功后是否重启业务容器；仅 DEPLOY_TARGET=docker 生效')
    string(name: 'PUBLISH_BRANCH_PATTERN', defaultValue: '^(main|master|release/.+)$', description: '允许推送镜像的分支正则')
    string(name: 'DOCKER_REGISTRY', defaultValue: 'k3d-kt-registry.localhost:5000', description: '镜像仓库地址；K8s 发布默认使用 fnOS NAS 上的 k3d 本地 registry')
    string(name: 'IMAGE_NAME', defaultValue: 'kt-template-online-api', description: 'Docker 镜像名称')
    string(name: 'IMAGE_TAG', defaultValue: '', description: '镜像标签，为空时使用 分支名-BUILD_NUMBER；PR 使用源分支名')
    string(name: 'CONTAINER_NAME', defaultValue: 'kt-template-online-api', description: '业务容器名称')
    string(name: 'CONTAINER_PORT', defaultValue: '48085', description: '宿主机映射端口，容器内固定使用 48085')
    string(name: 'CONTAINER_ENV_FILE', defaultValue: '/home/jenkins/agent/env/kt-template-online-api/.env.production', description: 'Agent workdir 内可读取的业务 env 文件路径')
    string(name: 'CONTAINER_NETWORK', defaultValue: 'bridge', description: '业务容器加入的 Docker 网络，默认使用 Docker bridge')
    string(name: 'CONTAINER_EXTRA_ARGS', defaultValue: '', description: 'docker run 额外参数，例如 -v /host/data:/app/data')
    string(name: 'KUBE_CONFIG_FILE', defaultValue: '/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml', description: 'Agent 容器内可读取的 kubeconfig 文件路径')
    string(name: 'K8S_MANIFEST_FILE', defaultValue: 'k8s/prod/api.yaml', description: 'K8s manifest 文件路径')
    string(name: 'K8S_NAMESPACE', defaultValue: 'kt-prod', description: 'K8s 命名空间')
    string(name: 'K8S_DEPLOYMENT', defaultValue: 'kt-template-online-api', description: 'K8s Deployment 名称')
    string(name: 'K8S_CONTAINER', defaultValue: 'api', description: 'Deployment 内业务容器名称')
    string(name: 'K8S_ENV_SECRET', defaultValue: 'kt-template-online-api-env', description: '由 .env.production 生成的 K8s Secret 名称')
    string(name: 'K8S_ROLLOUT_TIMEOUT', defaultValue: '180s', description: 'kubectl rollout status 超时时间')
  }

  environment {
    APP_PORT = '48085'
    CI = 'true'
    NODE_ENV = 'development'
    PNPM_VERSION = '9'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Prepare') {
      steps {
        script {
          def sourceName = resolveSourceName(env.BRANCH_NAME, env.CHANGE_BRANCH, env.CHANGE_ID, env.TAG_NAME)
          def branchTag = normalizeDockerTag(sourceName)
          def imageTagParam = params.IMAGE_TAG?.trim()
          env.IMAGE_TAG_FINAL = imageTagParam ? normalizeDockerTag(imageTagParam) : "${branchTag}-${env.BUILD_NUMBER}"
          env.IS_CHANGE_REQUEST = env.CHANGE_ID ? 'true' : 'false'
          def publishPattern = params.PUBLISH_BRANCH_PATTERN?.trim() ?: '^(main|master|release/.+)$'
          env.IS_PUBLISH_BRANCH = (!env.CHANGE_ID && isPublishBranch(env.BRANCH_NAME ?: '', publishPattern)) ? 'true' : 'false'
          def registry = params.DOCKER_REGISTRY?.trim()
          // Jenkins 已创建任务会缓存旧参数值；K8s 模式下空 registry 自动回退到 NAS 本地 registry。
          if (params.DEPLOY_TARGET == 'k8s' && !registry) {
            registry = 'k3d-kt-registry.localhost:5000'
            echo "DOCKER_REGISTRY is empty, fallback to ${registry} for K8s deploy."
          }
          env.DOCKER_REGISTRY_EFFECTIVE = registry ?: ''
          env.DOCKER_IMAGE = registry ? "${registry}/${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}" : "${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}"
          env.DOCKER_IMAGE_LATEST = registry ? "${registry}/${params.IMAGE_NAME}:latest" : "${params.IMAGE_NAME}:latest"

          // Agent 由 NAS 侧预先创建；这里仅确认 CI 所需的 Node/pnpm 环境可用。
          if (isUnix()) {
            runCmd("""
              node --version
              if ! command -v pnpm >/dev/null 2>&1; then
                if command -v corepack >/dev/null 2>&1; then
                  corepack enable
                  corepack prepare pnpm@${env.PNPM_VERSION} --activate
                else
                  echo "pnpm or corepack is required on the Jenkins Agent."
                  exit 1
                fi
              fi
              pnpm --version
            """.stripIndent())

            if (params.DEPLOY_TARGET == 'k8s') {
              runCmd("""
                if ! command -v kubectl >/dev/null 2>&1; then
                  echo "kubectl is required on the Jenkins Agent when DEPLOY_TARGET=k8s."
                  exit 1
                fi
                kubectl version --client=true
              """.stripIndent())
            }
          } else {
            if (params.DEPLOY_TARGET == 'k8s') {
              error('K8s deploy requires a Linux/NAS Jenkins Agent.')
            }
            runCmd('', """
              node --version
              where pnpm >nul 2>nul
              if errorlevel 1 (
                where corepack >nul 2>nul
                if errorlevel 1 exit /b 1
                corepack enable
                corepack prepare pnpm@${env.PNPM_VERSION} --activate
              )
              pnpm --version
            """.stripIndent())
          }

          echo """
            Branch: ${env.BRANCH_NAME ?: '-'}
            Change request: ${env.CHANGE_ID ?: '-'}
            Tag: ${env.TAG_NAME ?: '-'}
            Docker registry: ${env.DOCKER_REGISTRY_EFFECTIVE ?: '-'}
            Docker image: ${env.DOCKER_IMAGE}
            Docker latest: ${env.DOCKER_IMAGE_LATEST}
            Deploy target: ${params.DEPLOY_TARGET}
            Publish branch: ${env.IS_PUBLISH_BRANCH}
            Run container: ${params.RUN_DOCKER_CONTAINER}
          """.stripIndent()
        }
      }
    }

    stage('Install') {
      steps {
        script {
          runCmd('pnpm install --frozen-lockfile')
        }
      }
    }

    stage('Lint') {
      steps {
        script {
          runCmd('pnpm run lint')
        }
      }
    }

    stage('Test') {
      steps {
        script {
          // 当前单测配置查找 src/**/*.spec.ts，允许空测试集，后续补齐 spec 后仍会正常执行。
          runCmd('pnpm test --passWithNoTests')
        }
      }
    }

    stage('Build') {
      steps {
        script {
          runCmd('pnpm run build')
        }
      }
    }

    stage('Docker Build') {
      when {
        allOf {
          expression { return params.BUILD_DOCKER_IMAGE }
          expression { return env.IS_CHANGE_REQUEST != 'true' }
          expression { return params.DEPLOY_TARGET != 'none' }
        }
      }
      steps {
        script {
          if (isUnix()) {
            runCmd("""
              test -f dist/main.js
              docker build -f dockerfile -t ${env.DOCKER_IMAGE} .
              if [ '${env.DOCKER_IMAGE}' != '${env.DOCKER_IMAGE_LATEST}' ]; then
                docker tag ${env.DOCKER_IMAGE} ${env.DOCKER_IMAGE_LATEST}
              fi
            """.stripIndent())
          } else {
            runCmd('', """
              if not exist dist\\main.js exit /b 1
              docker build -f dockerfile -t ${env.DOCKER_IMAGE} .
              if not "${env.DOCKER_IMAGE}"=="${env.DOCKER_IMAGE_LATEST}" docker tag ${env.DOCKER_IMAGE} ${env.DOCKER_IMAGE_LATEST}
            """.stripIndent())
          }
        }
      }
    }

    stage('Docker Push') {
      when {
        allOf {
          expression { return params.BUILD_DOCKER_IMAGE && (params.PUSH_DOCKER_IMAGE || params.DEPLOY_TARGET == 'k8s') }
          expression { return env.IS_PUBLISH_BRANCH == 'true' }
          expression { return params.DEPLOY_TARGET != 'none' }
        }
      }
      steps {
        script {
          if (env.DOCKER_REGISTRY_EFFECTIVE?.trim()) {
            runCmd("""
              docker push ${env.DOCKER_IMAGE}
              docker push ${env.DOCKER_IMAGE_LATEST}
            """.stripIndent())
          } else {
            runCmd("docker push ${env.DOCKER_IMAGE}")
          }
        }
      }
    }

    stage('K8s Deploy') {
      when {
        allOf {
          expression { return params.BUILD_DOCKER_IMAGE }
          expression { return params.DEPLOY_TARGET == 'k8s' }
          expression { return env.IS_CHANGE_REQUEST != 'true' }
          expression { return env.IS_PUBLISH_BRANCH == 'true' }
        }
      }
      steps {
        script {
          if (!isUnix()) {
            error('K8s Deploy stage requires a Linux/NAS Jenkins Agent.')
          }

          def kubeConfigFile = params.KUBE_CONFIG_FILE?.trim()
          def manifestFile = params.K8S_MANIFEST_FILE?.trim() ?: 'k8s/prod/api.yaml'
          def namespace = params.K8S_NAMESPACE?.trim() ?: 'kt-prod'
          def deploymentName = params.K8S_DEPLOYMENT?.trim() ?: 'kt-template-online-api'
          def containerName = params.K8S_CONTAINER?.trim() ?: 'api'
          def envSecret = params.K8S_ENV_SECRET?.trim() ?: 'kt-template-online-api-env'
          def rolloutTimeout = params.K8S_ROLLOUT_TIMEOUT?.trim() ?: '180s'
          def containerEnvFile = params.CONTAINER_ENV_FILE?.trim()

          if (!kubeConfigFile) {
            error('KUBE_CONFIG_FILE is required when DEPLOY_TARGET=k8s.')
          }
          if (!containerEnvFile) {
            error('CONTAINER_ENV_FILE is required when DEPLOY_TARGET=k8s.')
          }

          def kubeConfigArg = "--kubeconfig ${shellQuote(kubeConfigFile)}"
          def namespaceArg = "-n ${shellQuote(namespace)}"
          def changeCause = "Jenkins ${env.JOB_NAME} #${env.BUILD_NUMBER} ${env.GIT_COMMIT ?: 'unknown'}"

          // 每次发布都从 Agent 私有 env 文件重建 Secret，避免真实配置进入 Git。
          runCmd("""
            set -e
            if [ ! -f ${shellQuote(kubeConfigFile)} ]; then
              echo "Kubeconfig file not found: ${kubeConfigFile}"
              exit 1
            fi
            if [ ! -f ${shellQuote(containerEnvFile)} ]; then
              echo "Container env file not found: ${containerEnvFile}"
              exit 1
            fi
            if [ ! -f ${shellQuote(manifestFile)} ]; then
              echo "K8s manifest file not found: ${manifestFile}"
              exit 1
            fi
          """.stripIndent())

          runCmd(buildEnvFileValidationScript(containerEnvFile))

          runCmd("""
            set -e
            kubectl ${kubeConfigArg} get namespace ${shellQuote(namespace)} >/dev/null
            kubectl ${kubeConfigArg} ${namespaceArg} create secret generic ${shellQuote(envSecret)} \\
              --from-env-file=${shellQuote(containerEnvFile)} \\
              --dry-run=client -o yaml | kubectl ${kubeConfigArg} apply -f -

            kubectl ${kubeConfigArg} apply -f ${shellQuote(manifestFile)}
            kubectl ${kubeConfigArg} ${namespaceArg} set image ${shellQuote("deployment/${deploymentName}")} ${shellQuote("${containerName}=${env.DOCKER_IMAGE}")}
            kubectl ${kubeConfigArg} ${namespaceArg} annotate ${shellQuote("deployment/${deploymentName}")} \\
              ${shellQuote("kubernetes.io/change-cause=${changeCause}")} --overwrite
            kubectl ${kubeConfigArg} ${namespaceArg} rollout status ${shellQuote("deployment/${deploymentName}")} --timeout=${shellQuote(rolloutTimeout)}
            kubectl ${kubeConfigArg} ${namespaceArg} get pod,svc -l app=${shellQuote(deploymentName)}
          """.stripIndent())
        }
      }
    }

    stage('Docker Run') {
      when {
        allOf {
          expression { return params.DEPLOY_TARGET == 'docker' }
          expression { return params.BUILD_DOCKER_IMAGE && params.RUN_DOCKER_CONTAINER }
          expression { return env.IS_CHANGE_REQUEST != 'true' }
          expression { return env.IS_PUBLISH_BRANCH == 'true' }
        }
      }
      steps {
        script {
          if (!isUnix()) {
            error('Docker Run stage requires a Linux/NAS Jenkins Agent.')
          }

          def containerName = params.CONTAINER_NAME?.trim() ?: 'kt-template-online-api'
          def containerPort = params.CONTAINER_PORT?.trim() ?: env.APP_PORT
          def containerEnvFile = params.CONTAINER_ENV_FILE?.trim()
          if (!containerEnvFile) {
            error('CONTAINER_ENV_FILE is required when RUN_DOCKER_CONTAINER is enabled.')
          }

          def networkArg = params.CONTAINER_NETWORK?.trim() ? "--network ${params.CONTAINER_NETWORK.trim()}" : ''
          def extraArgs = params.CONTAINER_EXTRA_ARGS?.trim() ?: ''

          // 部署阶段会替换同名容器；真实 env 文件只从 NAS 挂载进 Agent，不进入 Git。
          runCmd("""
            set -e
            if [ ! -f '${containerEnvFile}' ]; then
              echo "Container env file not found: ${containerEnvFile}"
              echo "Put .env.production under the existing Agent workdir volume, for example:"
              echo "/home/jenkins/agent/env/kt-template-online-api/.env.production"
              exit 1
            fi
          """.stripIndent())

          runCmd(buildEnvFileValidationScript(containerEnvFile))

          runCmd("""
            set -e
            docker rm -f '${containerName}' >/dev/null 2>&1 || true
            docker run -d \\
              --name '${containerName}' \\
              --restart=always \\
              ${networkArg} \\
              --env-file '${containerEnvFile}' \\
              -e NODE_ENV=production \\
              -p '${containerPort}':${env.APP_PORT} \\
              ${extraArgs} \\
              '${env.DOCKER_IMAGE}'

            docker ps --filter "name=^/${containerName}\$"
          """.stripIndent())
        }
      }
    }
  }

  post {
    success {
      archiveArtifacts artifacts: 'dist/**,package.json,pnpm-lock.yaml,dockerfile,k8s/**,ci/fnos-k8s/**', fingerprint: true, allowEmptyArchive: true
    }
  }
}
