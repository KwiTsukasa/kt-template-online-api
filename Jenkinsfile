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

def isDigestPinnedImage(String value) {
  return value && value ==~ /[a-z0-9][a-z0-9._-]*(?::[0-9]+)?(?:\/[a-z0-9][a-z0-9._-]*)+@sha256:[0-9a-f]{64}/
}

def extractDigestSuffix(String value) {
  def separator = value?.lastIndexOf('@') ?: -1
  return separator >= 0 ? value.substring(separator + 1) : ''
}

def requiredRuntimeEnvKeys() {
  return [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
    'ADMIN_TOKEN_SECRET',
    'FFLOGS_CLIENT_ID',
    'FFLOGS_CLIENT_SECRET',
    'QQBOT_PLUGIN_QUEUE_REDIS_HOST',
    'QQBOT_PLUGIN_QUEUE_REDIS_PORT',
    'NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET',
    'NETWORK_AGENT_ID',
    'NETWORK_AGENT_TARGET_IPV4',
    'NETWORK_AGENT_MQTT_URL',
    'NETWORK_AGENT_MQTT_CLIENT_ID',
    'NETWORK_AGENT_MQTT_USERNAME',
    'NETWORK_AGENT_MQTT_PASSWORD',
    'NETWORK_AGENT_MQTT_RETRY_MS',
    'PUBLIC_SECURITY_TRUSTED_PROXY_IPS',
    'PUBLIC_SECURITY_SWAGGER_ALLOWLIST',
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
    booleanParam(name: 'PREBUILT_RELEASE', defaultValue: false, description: '使用已构建的 API/Gateway 精确 digest 执行受控 K8s 发布；跳过依赖、测试和构建')
    booleanParam(name: 'TASK13_PREBUILD_ONLY', defaultValue: false, description: 'Task 13 仅构建并推送 API/Gateway，生成 exact digest 证据但不执行任何部署')
    string(name: 'PREBUILT_API_IMAGE', defaultValue: '', description: '预构建 API 镜像，必须为规范仓库的 repository@sha256:<64位小写摘要>')
    string(name: 'PREBUILT_MIGRATION_API_IMAGE', defaultValue: '', description: '本批次迁移使用的 API exact digest；维护租约始终绑定该值')
    string(name: 'PREBUILT_FALLBACK_API_IMAGE', defaultValue: '', description: '迁移前批准的 PBKDF2 兼容 fallback API exact digest')
    string(name: 'PREBUILT_GATEWAY_IMAGE', defaultValue: '', description: '预构建 Gateway 镜像，必须为规范仓库的 repository@sha256:<64位小写摘要>')
    string(name: 'EXPECTED_SOURCE_COMMIT', defaultValue: '', description: '预构建发布对应的 40 位小写 Git commit；必须等于 checkout HEAD')
    string(name: 'TASK13_MIGRATION_BATCH_ID', defaultValue: '', description: 'Task 13 维护批次，必须与 API Deployment 的活动维护租约一致')
    string(name: 'PUBLISH_BRANCH_PATTERN', defaultValue: '^(main|master|release/.+)$', description: '允许推送镜像的分支正则')
    string(name: 'DOCKER_REGISTRY', defaultValue: 'k3d-kt-registry.localhost:5000', description: '镜像仓库地址；K8s 发布默认使用 fnOS NAS 上的 k3d 本地 registry')
    string(name: 'IMAGE_NAME', defaultValue: 'kt-template-online-api', description: 'Docker 镜像名称')
    string(name: 'GATEWAY_IMAGE_NAME', defaultValue: 'kt-napcat-webui-gateway', description: 'NapCat WebUI Gateway Docker 镜像名称')
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
    string(name: 'QQBOT_NAPCAT_IMAGE_OVERRIDE', defaultValue: '', description: 'Verified NapCat runtime image to inject into API deployment; empty keeps manifest/default env')
    string(name: 'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE', defaultValue: '', description: 'Verified NapCat runtime profile version to inject into API deployment; empty keeps manifest/default env')
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
          env.GATEWAY_DOCKER_IMAGE = registry ? "${registry}/${params.GATEWAY_IMAGE_NAME}:${env.IMAGE_TAG_FINAL}" : "${params.GATEWAY_IMAGE_NAME}:${env.IMAGE_TAG_FINAL}"
          env.GATEWAY_DOCKER_IMAGE_LATEST = registry ? "${registry}/${params.GATEWAY_IMAGE_NAME}:latest" : "${params.GATEWAY_IMAGE_NAME}:latest"
          env.IMAGE_BUILD_PAIR = "${env.GIT_COMMIT ?: 'unknown'}:${env.BUILD_NUMBER}"
          env.IS_PREBUILT_RELEASE = params.PREBUILT_RELEASE ? 'true' : 'false'
          env.IS_TASK13_PREBUILD_ONLY = params.TASK13_PREBUILD_ONLY ? 'true' : 'false'

          if (isUnix()) {
            sh 'rm -f -- .kt-workspace/task13-prebuild/task13-exact-digests.env .kt-workspace/task13-prebuild/task13-exact-digests.env.tmp'
          }
          if (params.PREBUILT_RELEASE && params.TASK13_PREBUILD_ONLY) {
            error('TASK13_PREBUILD_ONLY cannot be combined with PREBUILT_RELEASE.')
          }
          def restrictedOverrideParameters = [
              'QQBOT_NAPCAT_IMAGE_OVERRIDE',
              'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE',
          ]
          restrictedOverrideParameters.each { parameterName ->
            if (
              (params.PREBUILT_RELEASE || params.TASK13_PREBUILD_ONLY) &&
              params[parameterName]?.trim()
            ) {
              error("${parameterName} must be empty in Task 13 restricted modes.")
            }
          }
          if (
            env.BRANCH_NAME == 'main' &&
            env.IS_CHANGE_REQUEST != 'true' &&
            !params.PREBUILT_RELEASE &&
            !params.TASK13_PREBUILD_ONLY
          ) {
            error('Task 13 blocks ordinary main deployment; select TASK13_PREBUILD_ONLY or PREBUILT_RELEASE explicitly.')
          }

          if (params.TASK13_PREBUILD_ONLY) {
            if (!isUnix()) {
              error('TASK13_PREBUILD_ONLY requires the Linux/NAS Jenkins Agent.')
            }
            if (
              env.IS_CHANGE_REQUEST == 'true' ||
              env.IS_PUBLISH_BRANCH != 'true' ||
              env.BRANCH_NAME != 'main'
            ) {
              error('TASK13_PREBUILD_ONLY is limited to the non-PR canonical main publish branch.')
            }

            def task13PrebuildBooleanContract = [
              'BUILD_DOCKER_IMAGE': true,
              'PUSH_DOCKER_IMAGE': true,
              'RUN_DOCKER_CONTAINER': false,
            ]
            task13PrebuildBooleanContract.each { parameterName, expectedValue ->
              if (params[parameterName] != expectedValue) {
                error("TASK13_PREBUILD_ONLY requires ${parameterName}=${expectedValue}.")
              }
            }
            def task13PrebuildStringContract = [
              'DEPLOY_TARGET': 'docker',
              'DOCKER_REGISTRY': 'k3d-kt-registry.localhost:5000',
              'IMAGE_NAME': 'kt-template-online-api',
              'GATEWAY_IMAGE_NAME': 'kt-napcat-webui-gateway',
              'IMAGE_TAG': '',
            ]
            task13PrebuildStringContract.each { parameterName, expectedValue ->
              if (params[parameterName]?.trim() != expectedValue) {
                error("TASK13_PREBUILD_ONLY requires ${parameterName}=${expectedValue}.")
              }
            }

            def checkedOutCommit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
            if (!(checkedOutCommit ==~ /[0-9a-f]{40}/) || checkedOutCommit != env.GIT_COMMIT) {
              error('TASK13_PREBUILD_ONLY requires GIT_COMMIT to equal the checked-out 40-character commit.')
            }
            def checkoutStatus = sh(
              script: 'git status --porcelain=v1 --untracked-files=all',
              returnStdout: true,
            ).trim()
            if (checkoutStatus) {
              error('TASK13_PREBUILD_ONLY requires a clean checkout.')
            }
            def remoteHeadsRaw = sh(
              script: 'git ls-remote --exit-code --heads origin refs/heads/main refs/heads/dev',
              returnStdout: true,
            ).trim()
            def remoteHeads = [:]
            remoteHeadsRaw.readLines().each { line ->
              def fields = line.trim().split(/\s+/)
              if (fields.size() == 2) {
                remoteHeads[fields[1]] = fields[0]
              }
            }
            if (
              remoteHeads['refs/heads/main'] != checkedOutCommit ||
              remoteHeads['refs/heads/dev'] != checkedOutCommit
            ) {
              error('Remote main/dev must both equal the checked-out commit before TASK13_PREBUILD_ONLY.')
            }

            env.DOCKER_IMAGE_LATEST = ''
            env.GATEWAY_DOCKER_IMAGE_LATEST = ''
            env.EXPECTED_SOURCE_COMMIT_FINAL = checkedOutCommit
          }

          if (params.PREBUILT_RELEASE) {
            if (!isUnix()) {
              error('PREBUILT_RELEASE requires the Linux/NAS Jenkins Agent.')
            }
            if (params.DEPLOY_TARGET != 'k8s') {
              error('PREBUILT_RELEASE requires DEPLOY_TARGET=k8s.')
            }
            if (env.IS_CHANGE_REQUEST == 'true' || env.IS_PUBLISH_BRANCH != 'true') {
              error('PREBUILT_RELEASE is limited to non-PR publish branches.')
            }
            if (env.BRANCH_NAME != 'main') {
              error('PREBUILT_RELEASE is restricted to the canonical main branch.')
            }

            def prebuiltK8sContract = [
              'KUBE_CONFIG_FILE': '/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml',
              'K8S_MANIFEST_FILE': 'k8s/prod/api.yaml',
              'K8S_NAMESPACE': 'kt-prod',
              'K8S_DEPLOYMENT': 'kt-template-online-api',
              'K8S_CONTAINER': 'api',
              'K8S_ENV_SECRET': 'kt-template-online-api-env',
              'CONTAINER_ENV_FILE': '/home/jenkins/agent/env/kt-template-online-api/.env.production',
            ]
            prebuiltK8sContract.each { parameterName, expectedValue ->
              if (params[parameterName]?.trim() != expectedValue) {
                error("PREBUILT_RELEASE requires ${parameterName}=${expectedValue}.")
              }
            }

            def prebuiltApiImage = params.PREBUILT_API_IMAGE?.trim()
            def migrationApiImage = params.PREBUILT_MIGRATION_API_IMAGE?.trim()
            def fallbackApiImage = params.PREBUILT_FALLBACK_API_IMAGE?.trim()
            def prebuiltGatewayImage = params.PREBUILT_GATEWAY_IMAGE?.trim()
            if (
              !isDigestPinnedImage(prebuiltApiImage) ||
              !prebuiltApiImage.startsWith('k3d-kt-registry.localhost:5000/kt-template-online-api@sha256:')
            ) {
              error('PREBUILT_API_IMAGE must be the canonical API repository pinned to a sha256 digest.')
            }
            if (
              !isDigestPinnedImage(migrationApiImage) ||
              !migrationApiImage.startsWith('k3d-kt-registry.localhost:5000/kt-template-online-api@sha256:')
            ) {
              error('PREBUILT_MIGRATION_API_IMAGE must be the canonical API repository pinned to a sha256 digest.')
            }
            if (
              !isDigestPinnedImage(fallbackApiImage) ||
              !fallbackApiImage.startsWith('k3d-kt-registry.localhost:5000/kt-template-online-api@sha256:') ||
              extractDigestSuffix(migrationApiImage) == extractDigestSuffix(fallbackApiImage)
            ) {
              error('PREBUILT_FALLBACK_API_IMAGE must be a distinct canonical API digest.')
            }
            if (prebuiltApiImage != migrationApiImage && prebuiltApiImage != fallbackApiImage) {
              error('PREBUILT_API_IMAGE must equal the migration image or approved fallback image.')
            }
            if (
              !isDigestPinnedImage(prebuiltGatewayImage) ||
              !prebuiltGatewayImage.startsWith('k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway@sha256:')
            ) {
              error('PREBUILT_GATEWAY_IMAGE must be the canonical Gateway repository pinned to a sha256 digest.')
            }

            def expectedSourceCommit = params.EXPECTED_SOURCE_COMMIT?.trim()
            if (!(expectedSourceCommit ==~ /[0-9a-f]{40}/)) {
              error('EXPECTED_SOURCE_COMMIT must be a 40-character lowercase Git commit.')
            }
            def checkedOutCommit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
            if (checkedOutCommit != expectedSourceCommit) {
              error("Checked-out HEAD ${checkedOutCommit} does not match EXPECTED_SOURCE_COMMIT ${expectedSourceCommit}.")
            }
            def checkoutStatus = sh(
              script: 'git status --porcelain=v1 --untracked-files=all',
              returnStdout: true,
            ).trim()
            if (checkoutStatus) {
              error('PREBUILT_RELEASE requires a clean checkout.')
            }
            def remoteHeadsRaw = sh(
              script: 'git ls-remote --exit-code --heads origin refs/heads/main refs/heads/dev',
              returnStdout: true,
            ).trim()
            def remoteHeads = [:]
            remoteHeadsRaw.readLines().each { line ->
              def fields = line.trim().split(/\s+/)
              if (fields.size() == 2) {
                remoteHeads[fields[1]] = fields[0]
              }
            }
            if (
              remoteHeads['refs/heads/main'] != expectedSourceCommit ||
              remoteHeads['refs/heads/dev'] != expectedSourceCommit
            ) {
              error('Remote main/dev must both equal EXPECTED_SOURCE_COMMIT before PREBUILT release.')
            }
            def task13MigrationBatchId = params.TASK13_MIGRATION_BATCH_ID?.trim()
            if (!(task13MigrationBatchId ==~ /[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}/)) {
              error('TASK13_MIGRATION_BATCH_ID must be an explicit UTC Task 13 batch identifier.')
            }

            env.DOCKER_IMAGE = prebuiltApiImage
            env.MIGRATION_API_IMAGE = migrationApiImage
            env.FALLBACK_API_IMAGE = fallbackApiImage
            env.GATEWAY_DOCKER_IMAGE = prebuiltGatewayImage
            env.DOCKER_IMAGE_LATEST = ''
            env.GATEWAY_DOCKER_IMAGE_LATEST = ''
            env.EXPECTED_SOURCE_COMMIT_FINAL = expectedSourceCommit
            env.TASK13_MIGRATION_BATCH_ID_FINAL = task13MigrationBatchId
          }

          // Agent 由 NAS 侧预先创建；预构建发布不依赖 Node/pnpm 构建环境。
          if (params.PREBUILT_RELEASE) {
            runCmd("""
              set -e
              if ! command -v kubectl >/dev/null 2>&1; then
                echo "kubectl is required for PREBUILT_RELEASE."
                exit 1
              fi
              kubectl version --client=true
              kubectl kustomize --help >/dev/null
            """.stripIndent())
          } else if (isUnix()) {
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
            Docker latest: ${env.DOCKER_IMAGE_LATEST ?: '-'}
            Gateway image: ${env.GATEWAY_DOCKER_IMAGE}
            Gateway latest: ${env.GATEWAY_DOCKER_IMAGE_LATEST ?: '-'}
            Deploy target: ${params.DEPLOY_TARGET}
            Publish branch: ${env.IS_PUBLISH_BRANCH}
            Prebuilt release: ${env.IS_PREBUILT_RELEASE}
            Task 13 prebuild only: ${env.IS_TASK13_PREBUILD_ONLY}
            Run container: ${params.RUN_DOCKER_CONTAINER}
          """.stripIndent()
        }
      }
    }

    stage('Install') {
      when {
        expression { return env.IS_PREBUILT_RELEASE != 'true' }
      }
      steps {
        script {
          runCmd("""
            pnpm config set registry https://registry.npmmirror.com
            pnpm config set fetch-retries 5
            pnpm config set fetch-retry-factor 2
            pnpm config set fetch-retry-mintimeout 10000
            pnpm config set fetch-retry-maxtimeout 120000
            pnpm config set network-concurrency 4
            pnpm install --frozen-lockfile --prefer-offline
          """.stripIndent())
        }
      }
    }

    stage('Lint') {
      when {
        expression { return env.IS_PREBUILT_RELEASE != 'true' }
      }
      steps {
        script {
          runCmd('pnpm run lint')
        }
      }
    }

    stage('Test') {
      when {
        expression { return env.IS_PREBUILT_RELEASE != 'true' }
      }
      steps {
        script {
          // 直接执行 Jest，避免不同 pnpm 版本把 --passWithNoTests 当成测试匹配模式。
          runCmd('pnpm exec jest --passWithNoTests')
        }
      }
    }

    stage('Build') {
      when {
        expression { return env.IS_PREBUILT_RELEASE != 'true' }
      }
      steps {
        script {
          runCmd('pnpm run build')
        }
      }
    }

    stage('Docker Build') {
      when {
        allOf {
          expression { return env.IS_PREBUILT_RELEASE != 'true' }
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
              test -f dist/apps/napcat-webui-gateway/main.js
              docker build -f dockerfile \
                --label org.opencontainers.image.revision=${shellQuote(env.GIT_COMMIT)} \
                --label kt.kwitsukasa.top/build-pair=${shellQuote(env.IMAGE_BUILD_PAIR)} \
                -t ${env.DOCKER_IMAGE} .
              docker build -f dockerfile.gateway \
                --label org.opencontainers.image.revision=${shellQuote(env.GIT_COMMIT)} \
                --label kt.kwitsukasa.top/build-pair=${shellQuote(env.IMAGE_BUILD_PAIR)} \
                -t ${env.GATEWAY_DOCKER_IMAGE} .
              if [ -n ${shellQuote(env.DOCKER_IMAGE_LATEST)} ] && [ ${shellQuote(env.DOCKER_IMAGE)} != ${shellQuote(env.DOCKER_IMAGE_LATEST)} ]; then
                docker tag ${env.DOCKER_IMAGE} ${env.DOCKER_IMAGE_LATEST}
              fi
              if [ -n ${shellQuote(env.GATEWAY_DOCKER_IMAGE_LATEST)} ] && [ ${shellQuote(env.GATEWAY_DOCKER_IMAGE)} != ${shellQuote(env.GATEWAY_DOCKER_IMAGE_LATEST)} ]; then
                docker tag ${env.GATEWAY_DOCKER_IMAGE} ${env.GATEWAY_DOCKER_IMAGE_LATEST}
              fi
            """.stripIndent())
          } else {
            runCmd('', """
              if not exist dist\\main.js exit /b 1
              if not exist dist\\apps\\napcat-webui-gateway\\main.js exit /b 1
              docker build -f dockerfile -t ${env.DOCKER_IMAGE} .
              docker build -f dockerfile.gateway -t ${env.GATEWAY_DOCKER_IMAGE} .
              if not "${env.DOCKER_IMAGE}"=="${env.DOCKER_IMAGE_LATEST}" docker tag ${env.DOCKER_IMAGE} ${env.DOCKER_IMAGE_LATEST}
              if not "${env.GATEWAY_DOCKER_IMAGE}"=="${env.GATEWAY_DOCKER_IMAGE_LATEST}" docker tag ${env.GATEWAY_DOCKER_IMAGE} ${env.GATEWAY_DOCKER_IMAGE_LATEST}
            """.stripIndent())
          }
        }
      }
    }

    stage('Docker Push') {
      when {
        allOf {
          expression { return env.IS_PREBUILT_RELEASE != 'true' }
          expression { return params.BUILD_DOCKER_IMAGE && (params.PUSH_DOCKER_IMAGE || params.DEPLOY_TARGET == 'k8s') }
          expression { return env.IS_PUBLISH_BRANCH == 'true' }
          expression { return params.DEPLOY_TARGET != 'none' }
        }
      }
      steps {
        script {
          if (env.IS_TASK13_PREBUILD_ONLY == 'true') {
            runCmd("""
              set -e
              umask 077
              API_IMAGE=${shellQuote(env.DOCKER_IMAGE)}
              GATEWAY_IMAGE=${shellQuote(env.GATEWAY_DOCKER_IMAGE)}
              API_REPOSITORY=${shellQuote("${env.DOCKER_REGISTRY_EFFECTIVE}/${params.IMAGE_NAME}")}
              GATEWAY_REPOSITORY=${shellQuote("${env.DOCKER_REGISTRY_EFFECTIVE}/${params.GATEWAY_IMAGE_NAME}")}
              EVIDENCE_DIR=.kt-workspace/task13-prebuild
              EVIDENCE_FILE="\$EVIDENCE_DIR/task13-exact-digests.env"
              EVIDENCE_TEMP="\$EVIDENCE_FILE.tmp"
              cleanup_task13_prebuild_evidence() {
                rm -f -- "\$EVIDENCE_TEMP"
              }
              trap cleanup_task13_prebuild_evidence EXIT HUP INT TERM

              docker push "\$API_IMAGE"
              docker push "\$GATEWAY_IMAGE"
              API_EXACT_IMAGE="\$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "\$API_IMAGE" | awk -v prefix="\$API_REPOSITORY@" 'index(\$0, prefix) == 1 { print; exit }')"
              GATEWAY_EXACT_IMAGE="\$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "\$GATEWAY_IMAGE" | awk -v prefix="\$GATEWAY_REPOSITORY@" 'index(\$0, prefix) == 1 { print; exit }')"
              API_DIGEST="\${API_EXACT_IMAGE#"\$API_REPOSITORY@"}"
              GATEWAY_DIGEST="\${GATEWAY_EXACT_IMAGE#"\$GATEWAY_REPOSITORY@"}"
              if ! printf '%s' "\$API_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}\$'; then
                echo "Task 13 API exact digest evidence is invalid."
                exit 1
              fi
              if ! printf '%s' "\$GATEWAY_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}\$'; then
                echo "Task 13 Gateway exact digest evidence is invalid."
                exit 1
              fi

              API_REVISION="\$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "\$API_IMAGE")"
              GATEWAY_REVISION="\$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "\$GATEWAY_IMAGE")"
              API_BUILD_PAIR="\$(docker image inspect --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' "\$API_IMAGE")"
              GATEWAY_BUILD_PAIR="\$(docker image inspect --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' "\$GATEWAY_IMAGE")"
              if [ "\$API_REVISION" != ${shellQuote(env.EXPECTED_SOURCE_COMMIT_FINAL)} ] || [ "\$GATEWAY_REVISION" != ${shellQuote(env.EXPECTED_SOURCE_COMMIT_FINAL)} ]; then
                echo "Task 13 prebuilt image revision drifted from the checked-out commit."
                exit 1
              fi
              if [ -z "\$API_BUILD_PAIR" ] || [ "\$API_BUILD_PAIR" != "\$GATEWAY_BUILD_PAIR" ] || [ "\$API_BUILD_PAIR" != ${shellQuote(env.IMAGE_BUILD_PAIR)} ]; then
                echo "Task 13 API and Gateway images do not share the expected build pair."
                exit 1
              fi

              mkdir -p -- "\$EVIDENCE_DIR"
              {
                printf 'API_IMAGE=%s\\n' "\$API_EXACT_IMAGE"
                printf 'GATEWAY_IMAGE=%s\\n' "\$GATEWAY_EXACT_IMAGE"
                printf 'SOURCE_REVISION=%s\\n' "\$API_REVISION"
                printf 'BUILD_PAIR=%s\\n' "\$API_BUILD_PAIR"
              } > "\$EVIDENCE_TEMP"
              chmod 600 "\$EVIDENCE_TEMP"
              mv -f -- "\$EVIDENCE_TEMP" "\$EVIDENCE_FILE"
              trap - EXIT HUP INT TERM
              printf 'Task 13 exact digest evidence: %s\\n' "\$EVIDENCE_FILE"
            """.stripIndent())
          } else if (env.DOCKER_REGISTRY_EFFECTIVE?.trim()) {
            runCmd("""
              docker push ${env.DOCKER_IMAGE}
              docker push ${env.DOCKER_IMAGE_LATEST}
              docker push ${env.GATEWAY_DOCKER_IMAGE}
              docker push ${env.GATEWAY_DOCKER_IMAGE_LATEST}
            """.stripIndent())
          } else {
            runCmd("""
              docker push ${env.DOCKER_IMAGE}
              docker push ${env.GATEWAY_DOCKER_IMAGE}
            """.stripIndent())
          }
        }
      }
    }

    stage('K8s Deploy') {
      when {
        allOf {
          expression { return env.IS_TASK13_PREBUILD_ONLY != 'true' }
          expression { return params.BUILD_DOCKER_IMAGE || env.IS_PREBUILT_RELEASE == 'true' }
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
          def gatewayDeploymentName = 'kt-napcat-webui-gateway'
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
          def napcatImageOverride = params.QQBOT_NAPCAT_IMAGE_OVERRIDE?.trim()
          def napcatProfileOverride = params.QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE?.trim()
          def replicasJsonPath = '{.spec.replicas}'
          def apiImageJsonPath = "{.spec.template.spec.containers[?(@.name==\"${containerName}\")].image}"
          def gatewayImageJsonPath = '{.spec.template.spec.containers[?(@.name=="gateway")].image}'
          def maintenanceStateJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-maintenance}'
          def maintenanceBatchJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-maintenance-batch}'
          def maintenanceImageJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-migration-image}'
          def fallbackImageJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-fallback-image}'
          def environmentShaJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-env-sha256}'
          def offNasBackupJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-off-nas-backup-sha256}'
          def blogVerifiedJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-blog-verified}'
          def adminVerifiedJsonPath = '{.metadata.annotations.kt\\.kwitsukasa\\.top/task13-admin-verified}'
          def task13AttestationPrefix = "${env.TASK13_MIGRATION_BATCH_ID_FINAL}:"

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

          if (env.IS_PREBUILT_RELEASE == 'true') {
            runCmd("""
              set -e
              if [ ! -f ${shellQuote(containerEnvFile)} ] || [ -L ${shellQuote(containerEnvFile)} ]; then
                echo "Task 13 production env must be a regular non-symbolic file."
                exit 1
              fi
              if [ "\$(stat -c '%a' ${shellQuote(containerEnvFile)})" != "600" ]; then
                echo "Task 13 production env must use mode 0600."
                exit 1
              fi
              if [ "\$(stat -c '%u' ${shellQuote(containerEnvFile)})" != "\$(id -u)" ]; then
                echo "Task 13 production env must be owned by the Jenkins Agent user."
                exit 1
              fi
              kubectl ${kubeConfigArg} get namespace ${shellQuote(namespace)} >/dev/null
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(replicasJsonPath)})" != "0" ]; then
                echo "Task 13 maintenance requires zero desired API replicas."
                exit 1
              fi
              if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name)" ]; then
                echo "Task 13 maintenance requires zero API Pods."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceStateJsonPath)})" != "active" ]; then
                echo "Task 13 maintenance lease is not active."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceBatchJsonPath)})" != ${shellQuote(env.TASK13_MIGRATION_BATCH_ID_FINAL)} ]; then
                echo "Task 13 maintenance batch does not match the release."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceImageJsonPath)})" != ${shellQuote(env.MIGRATION_API_IMAGE)} ]; then
                echo "Task 13 maintenance image does not match the migration digest."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(fallbackImageJsonPath)})" != ${shellQuote(env.FALLBACK_API_IMAGE)} ]; then
                echo "Task 13 fallback image does not match the approved digest."
                exit 1
              fi
              ENV_SHA256="\$(sha256sum -- ${shellQuote(containerEnvFile)} | awk '{print \$1}')"
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(environmentShaJsonPath)})" != "\$ENV_SHA256" ]; then
                echo "Task 13 production env fingerprint does not match migration."
                exit 1
              fi
              OFF_NAS_SHA256="\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(offNasBackupJsonPath)})"
              BLOG_VERIFIED_SHA256="\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(blogVerifiedJsonPath)})"
              ADMIN_VERIFIED_SHA256="\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(adminVerifiedJsonPath)})"
              TASK13_ATTESTATION_PREFIX=${shellQuote(task13AttestationPrefix)}
              require_task13_attestation() {
                ATTESTATION_VALUE="\$1"
                ATTESTATION_ERROR="\$2"
                case "\$ATTESTATION_VALUE" in
                  "\$TASK13_ATTESTATION_PREFIX"*) ;;
                  *) echo "\$ATTESTATION_ERROR"; exit 1 ;;
                esac
                ATTESTATION_SHA256="\${ATTESTATION_VALUE#"\$TASK13_ATTESTATION_PREFIX"}"
                if ! printf '%s' "\$ATTESTATION_SHA256" | grep -Eq '^[0-9a-f]{64}\$'; then
                  echo "\$ATTESTATION_ERROR"
                  exit 1
                fi
              }
              require_task13_attestation "\$OFF_NAS_SHA256" "Task 13 off-NAS backup attestation is missing."
              require_task13_attestation "\$BLOG_VERIFIED_SHA256" "Task 13 Blog verification attestation is missing."
              require_task13_attestation "\$ADMIN_VERIFIED_SHA256" "Task 13 Admin verification attestation is missing."
              docker pull ${shellQuote(env.MIGRATION_API_IMAGE)}
              docker pull ${shellQuote(env.FALLBACK_API_IMAGE)}
              docker pull ${shellQuote(env.GATEWAY_DOCKER_IMAGE)}
              MIGRATION_IMAGE_ID="\$(docker image inspect --format '{{.Id}}' ${shellQuote(env.MIGRATION_API_IMAGE)})"
              FALLBACK_IMAGE_ID="\$(docker image inspect --format '{{.Id}}' ${shellQuote(env.FALLBACK_API_IMAGE)})"
              if [ -z "\$MIGRATION_IMAGE_ID" ] || [ -z "\$FALLBACK_IMAGE_ID" ] || [ "\$MIGRATION_IMAGE_ID" = "\$FALLBACK_IMAGE_ID" ]; then
                echo "Migration and fallback images resolve to the same Docker image ID."
                exit 1
              fi
              MIGRATION_REVISION="\$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' ${shellQuote(env.MIGRATION_API_IMAGE)})"
              GATEWAY_REVISION="\$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' ${shellQuote(env.GATEWAY_DOCKER_IMAGE)})"
              MIGRATION_BUILD_PAIR="\$(docker image inspect --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' ${shellQuote(env.MIGRATION_API_IMAGE)})"
              GATEWAY_BUILD_PAIR="\$(docker image inspect --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' ${shellQuote(env.GATEWAY_DOCKER_IMAGE)})"
              if [ "\$MIGRATION_REVISION" != ${shellQuote(env.EXPECTED_SOURCE_COMMIT_FINAL)} ] || [ "\$GATEWAY_REVISION" != ${shellQuote(env.EXPECTED_SOURCE_COMMIT_FINAL)} ]; then
                echo "Target image revision does not match EXPECTED_SOURCE_COMMIT."
                exit 1
              fi
              if [ -z "\$MIGRATION_BUILD_PAIR" ] || [ "\$MIGRATION_BUILD_PAIR" != "\$GATEWAY_BUILD_PAIR" ]; then
                echo "API and Gateway images are not from the same build."
                exit 1
              fi
            """.stripIndent())
          }

          runCmd("""
            set -e
            kubectl ${kubeConfigArg} get namespace ${shellQuote(namespace)} >/dev/null
            kubectl ${kubeConfigArg} ${namespaceArg} create secret generic ${shellQuote(envSecret)} \\
              --from-env-file=${shellQuote(containerEnvFile)} \\
              --dry-run=client -o yaml | kubectl ${kubeConfigArg} apply -f -
          """.stripIndent())

          if (env.IS_PREBUILT_RELEASE == 'true') {
            def apiImageSeparator = env.DOCKER_IMAGE.lastIndexOf('@')
            def gatewayImageSeparator = env.GATEWAY_DOCKER_IMAGE.lastIndexOf('@')
            def apiImageRepository = env.DOCKER_IMAGE.substring(0, apiImageSeparator)
            def apiImageDigest = env.DOCKER_IMAGE.substring(apiImageSeparator + 1)
            def gatewayImageRepository = env.GATEWAY_DOCKER_IMAGE.substring(0, gatewayImageSeparator)
            def gatewayImageDigest = env.GATEWAY_DOCKER_IMAGE.substring(gatewayImageSeparator + 1)

            runCmd("""
              set -e
              OVERLAY_DIR="\$(mktemp -d .jenkins-kustomize.XXXXXX)"
              RENDERED_MANIFEST="\$OVERLAY_DIR/rendered.yaml"
              cleanup_overlay() {
                rm -rf -- "\$OVERLAY_DIR"
              }
              trap cleanup_overlay EXIT
              trap 'exit 1' HUP INT TERM

              cp -- ${shellQuote(manifestFile)} "\$OVERLAY_DIR/api.yaml"
              cat > "\$OVERLAY_DIR/kustomization.yaml" <<'KUSTOMIZATION'
              apiVersion: kustomize.config.k8s.io/v1beta1
              kind: Kustomization
              resources:
                - api.yaml
              images:
                - name: k3d-kt-registry.localhost:5000/kt-template-online-api
                  newName: ${apiImageRepository}
                  digest: ${apiImageDigest}
                - name: k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway
                  newName: ${gatewayImageRepository}
                  digest: ${gatewayImageDigest}
              patches:
                - target:
                    group: apps
                    version: v1
                    kind: Deployment
                    name: kt-template-online-api
                  patch: |-
                    - op: replace
                      path: /spec/replicas
                      value: 0
              KUSTOMIZATION

              kubectl kustomize "\$OVERLAY_DIR" > "\$RENDERED_MANIFEST"
              awk \\
                -v api_deployment=${shellQuote(deploymentName)} \\
                -v gateway_deployment=${shellQuote(gatewayDeploymentName)} \\
                -v api_image=${shellQuote(env.DOCKER_IMAGE)} \\
                -v gateway_image=${shellQuote(env.GATEWAY_DOCKER_IMAGE)} '
                function reset_document() {
                  kind = ""
                  name = ""
                  replicas = ""
                  api_images = 0
                  gateway_images = 0
                }
                function finish_document() {
                  if (kind != "Deployment") return
                  if (name == api_deployment) {
                    api_documents += 1
                    if (replicas != "0" || api_images != 1 || gateway_images != 0) failed = 1
                  }
                  if (name == gateway_deployment) {
                    gateway_documents += 1
                    if (gateway_images != 1 || api_images != 0) failed = 1
                  }
                }
                BEGIN { reset_document() }
                \$0 == "---" {
                  finish_document()
                  reset_document()
                  next
                }
                \$1 == "kind:" { kind = \$2 }
                \$1 == "name:" && \$0 ~ /^  name:/ { name = \$2 }
                \$1 == "replicas:" && \$0 ~ /^  replicas:/ { replicas = \$2 }
                index(\$0, "image: " api_image) > 0 { api_images += 1 }
                index(\$0, "image: " gateway_image) > 0 { gateway_images += 1 }
                END {
                  finish_document()
                  if (failed || api_documents != 1 || gateway_documents != 1) {
                    print "Rendered prebuilt manifest failed the exact image or zero-replica contract." > "/dev/stderr"
                    exit 1
                  }
                }
              ' "\$RENDERED_MANIFEST"
              kubectl ${kubeConfigArg} apply --dry-run=client --validate=false -f "\$RENDERED_MANIFEST" >/dev/null
              restore_prebuilt_api_zero() {
                set +e
                restore_failed=0
                kubectl ${kubeConfigArg} ${namespaceArg} scale ${shellQuote("deployment/${deploymentName}")} --replicas=0 >/dev/null 2>&1 \
                  || restore_failed=1
                if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name 2>/dev/null)" ]; then
                  kubectl ${kubeConfigArg} ${namespaceArg} wait --for=delete pod \
                    -l ${shellQuote("app=${deploymentName}")} --timeout=${shellQuote(rolloutTimeout)} >/dev/null 2>&1 \
                    || restore_failed=1
                fi
                if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(replicasJsonPath)} 2>/dev/null)" != "0" ]; then
                  restore_failed=1
                fi
                if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name 2>/dev/null)" ]; then
                  restore_failed=1
                fi
                if [ "\$restore_failed" -ne 0 ]; then
                  echo "Prebuilt release recovery could not restore API to zero." >&2
                fi
                return "\$restore_failed"
              }
              finish_prebuilt_apply() {
                APPLY_EXIT_CODE=\$?
                restore_prebuilt_api_zero || APPLY_EXIT_CODE=1
                cleanup_overlay
                trap - EXIT HUP INT TERM
                exit "\$APPLY_EXIT_CODE"
              }
              trap finish_prebuilt_apply EXIT
              kubectl ${kubeConfigArg} apply -f "\$RENDERED_MANIFEST"
            """.stripIndent())
          } else {
            runCmd("""
              set -e
              kubectl ${kubeConfigArg} apply -f ${shellQuote(manifestFile)}
              kubectl ${kubeConfigArg} ${namespaceArg} set image ${shellQuote("deployment/${deploymentName}")} ${shellQuote("${containerName}=${env.DOCKER_IMAGE}")}
              kubectl ${kubeConfigArg} ${namespaceArg} set image ${shellQuote('deployment/kt-napcat-webui-gateway')} ${shellQuote("gateway=${env.GATEWAY_DOCKER_IMAGE}")}
            """.stripIndent())
          }

          if (napcatImageOverride) {
            runCmd("kubectl ${kubeConfigArg} ${namespaceArg} set env ${shellQuote("deployment/${deploymentName}")} ${shellQuote("QQBOT_NAPCAT_IMAGE=${napcatImageOverride}")}")
          }
          if (napcatProfileOverride) {
            runCmd("kubectl ${kubeConfigArg} ${namespaceArg} set env ${shellQuote("deployment/${deploymentName}")} ${shellQuote("QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=${napcatProfileOverride}")}")
          }

          if (env.IS_PREBUILT_RELEASE == 'true') {
            runCmd("""
              set -e
              prebuilt_release_complete=false
              restore_prebuilt_api_zero() {
                if [ "\$prebuilt_release_complete" = "true" ]; then
                  return
                fi
                set +e
                restore_failed=0
                kubectl ${kubeConfigArg} ${namespaceArg} scale ${shellQuote("deployment/${deploymentName}")} --replicas=0 >/dev/null 2>&1 \
                  || restore_failed=1
                if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name 2>/dev/null)" ]; then
                  kubectl ${kubeConfigArg} ${namespaceArg} wait --for=delete pod \
                    -l ${shellQuote("app=${deploymentName}")} --timeout=${shellQuote(rolloutTimeout)} >/dev/null 2>&1 \
                    || restore_failed=1
                fi
                if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(replicasJsonPath)} 2>/dev/null)" != "0" ]; then
                  restore_failed=1
                fi
                if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name 2>/dev/null)" ]; then
                  restore_failed=1
                fi
                if [ "\$restore_failed" -ne 0 ]; then
                  echo "Prebuilt release recovery could not restore API to zero." >&2
                fi
              }
              trap restore_prebuilt_api_zero EXIT
              trap 'exit 1' HUP INT TERM
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(replicasJsonPath)})" != "0" ]; then
                echo "Prebuilt API deployment was not applied at zero replicas."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(apiImageJsonPath)})" != ${shellQuote(env.DOCKER_IMAGE)} ]; then
                echo "Prebuilt API deployment image does not match the requested digest."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote('deployment/kt-napcat-webui-gateway')} -o jsonpath=${shellQuote(gatewayImageJsonPath)})" != ${shellQuote(env.GATEWAY_DOCKER_IMAGE)} ]; then
                echo "Prebuilt Gateway deployment image does not match the requested digest."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceStateJsonPath)})" != "active" ]; then
                echo "Task 13 maintenance lease is not active."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceBatchJsonPath)})" != ${shellQuote(env.TASK13_MIGRATION_BATCH_ID_FINAL)} ]; then
                echo "Task 13 maintenance batch does not match the release."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(maintenanceImageJsonPath)})" != ${shellQuote(env.MIGRATION_API_IMAGE)} ]; then
                echo "Task 13 maintenance image does not match the migration digest."
                exit 1
              fi
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(fallbackImageJsonPath)})" != ${shellQuote(env.FALLBACK_API_IMAGE)} ]; then
                echo "Task 13 fallback image does not match the approved digest."
                exit 1
              fi
              ENV_SHA256="\$(sha256sum -- ${shellQuote(containerEnvFile)} | awk '{print \$1}')"
              if [ "\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath=${shellQuote(environmentShaJsonPath)})" != "\$ENV_SHA256" ]; then
                echo "Task 13 production env fingerprint does not match migration."
                exit 1
              fi
              for ATTESTATION_JSONPATH in \
                ${shellQuote(offNasBackupJsonPath)} \
                ${shellQuote(blogVerifiedJsonPath)} \
                ${shellQuote(adminVerifiedJsonPath)}
              do
                ATTESTATION_VALUE="\$(kubectl ${kubeConfigArg} ${namespaceArg} get ${shellQuote("deployment/${deploymentName}")} -o jsonpath="\$ATTESTATION_JSONPATH")"
                TASK13_ATTESTATION_PREFIX=${shellQuote(task13AttestationPrefix)}
                case "\$ATTESTATION_VALUE" in
                  "\$TASK13_ATTESTATION_PREFIX"*) ;;
                  *) echo "Task 13 migration completion attestation drifted."; exit 1 ;;
                esac
                ATTESTATION_SHA256="\${ATTESTATION_VALUE#"\$TASK13_ATTESTATION_PREFIX"}"
                if ! printf '%s' "\$ATTESTATION_SHA256" | grep -Eq '^[0-9a-f]{64}\$'; then
                  echo "Task 13 migration completion attestation drifted."
                  exit 1
                fi
              done
              if [ -n "\$(kubectl ${kubeConfigArg} ${namespaceArg} get pods -l ${shellQuote("app=${deploymentName}")} -o name)" ]; then
                echo "Task 13 API Pods reappeared before release."
                exit 1
              fi
              kubectl ${kubeConfigArg} ${namespaceArg} annotate ${shellQuote("deployment/${deploymentName}")} \\
                ${shellQuote("kubernetes.io/change-cause=${changeCause}")} --overwrite
              kubectl ${kubeConfigArg} ${namespaceArg} annotate ${shellQuote('deployment/kt-napcat-webui-gateway')} \\
                ${shellQuote("kubernetes.io/change-cause=${changeCause}")} --overwrite
              kubectl ${kubeConfigArg} ${namespaceArg} scale ${shellQuote("deployment/${deploymentName}")} --replicas=1
              kubectl ${kubeConfigArg} ${namespaceArg} rollout status ${shellQuote("deployment/${deploymentName}")} --timeout=${shellQuote(rolloutTimeout)}
              kubectl ${kubeConfigArg} ${namespaceArg} rollout status ${shellQuote('deployment/kt-napcat-webui-gateway')} --timeout=${shellQuote(rolloutTimeout)}
              kubectl ${kubeConfigArg} ${namespaceArg} get pod,svc -l ${shellQuote("app in (${deploymentName},${gatewayDeploymentName})")}
              prebuilt_release_complete=true
              trap - EXIT HUP INT TERM
            """.stripIndent())
          } else {
            runCmd("""
              set -e
              kubectl ${kubeConfigArg} ${namespaceArg} annotate ${shellQuote("deployment/${deploymentName}")} \\
                ${shellQuote("kubernetes.io/change-cause=${changeCause}")} --overwrite
              kubectl ${kubeConfigArg} ${namespaceArg} annotate ${shellQuote('deployment/kt-napcat-webui-gateway')} \\
                ${shellQuote("kubernetes.io/change-cause=${changeCause}")} --overwrite
              kubectl ${kubeConfigArg} ${namespaceArg} rollout status ${shellQuote("deployment/${deploymentName}")} --timeout=${shellQuote(rolloutTimeout)}
              kubectl ${kubeConfigArg} ${namespaceArg} rollout status ${shellQuote('deployment/kt-napcat-webui-gateway')} --timeout=${shellQuote(rolloutTimeout)}
              kubectl ${kubeConfigArg} ${namespaceArg} get pod,svc -l ${shellQuote("app in (${deploymentName},${gatewayDeploymentName})")}
            """.stripIndent())
          }
        }
      }
    }

    stage('Docker Run') {
      when {
        allOf {
          expression { return env.IS_TASK13_PREBUILD_ONLY != 'true' }
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
      archiveArtifacts artifacts: 'dist/**,package.json,pnpm-lock.yaml,dockerfile,dockerfile.gateway,k8s/**,ci/fnos-k8s/**,.kt-workspace/task13-prebuild/task13-exact-digests.env', fingerprint: true, allowEmptyArchive: true
    }
  }
}
