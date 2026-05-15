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

def resolveSourceName(String branchName, String changeBranch, String changeId, String tagName) {
  if (changeId) {
    return changeBranch ?: "PR-${changeId}"
  }
  return tagName ?: branchName ?: 'local'
}

def isPublishBranch(String branchName, String pattern) {
  return branchName ==~ pattern
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
    booleanParam(name: 'BUILD_DOCKER_IMAGE', defaultValue: true, description: '是否在非 PR 分支使用项目现有 dockerfile 构建镜像')
    booleanParam(name: 'PUSH_DOCKER_IMAGE', defaultValue: false, description: '是否执行 docker push；仅发布分支生效，需要 Agent 已提前完成 docker login')
    string(name: 'PUBLISH_BRANCH_PATTERN', defaultValue: '^(main|master|release/.+)$', description: '允许推送镜像的分支正则')
    string(name: 'DOCKER_REGISTRY', defaultValue: '', description: '镜像仓库地址，为空时只生成本地镜像')
    string(name: 'IMAGE_NAME', defaultValue: 'kt-template-online-api', description: 'Docker 镜像名称')
    string(name: 'IMAGE_TAG', defaultValue: '', description: '镜像标签，为空时使用 分支名-BUILD_NUMBER；PR 使用源分支名')
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
          env.DOCKER_IMAGE = registry ? "${registry}/${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}" : "${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}"

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
          } else {
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
            Docker image: ${env.DOCKER_IMAGE}
            Publish branch: ${env.IS_PUBLISH_BRANCH}
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
          runCmd('pnpm test -- --passWithNoTests')
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
        }
      }
      steps {
        script {
          runCmd("docker build -f dockerfile -t ${env.DOCKER_IMAGE} .")
        }
      }
    }

    stage('Docker Push') {
      when {
        allOf {
          expression { return params.BUILD_DOCKER_IMAGE && params.PUSH_DOCKER_IMAGE }
          expression { return env.IS_PUBLISH_BRANCH == 'true' }
        }
      }
      steps {
        script {
          runCmd("docker push ${env.DOCKER_IMAGE}")
        }
      }
    }
  }

  post {
    success {
      archiveArtifacts artifacts: 'dist/**,package.json,pnpm-lock.yaml,dockerfile', fingerprint: true, allowEmptyArchive: true
    }
  }
}
