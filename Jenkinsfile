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

pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
  }

  parameters {
    booleanParam(name: 'BUILD_DOCKER_IMAGE', defaultValue: true, description: '是否使用项目现有 dockerfile 构建镜像')
    booleanParam(name: 'PUSH_DOCKER_IMAGE', defaultValue: false, description: '是否执行 docker push；需要 Jenkins Agent 已提前完成 docker login')
    string(name: 'DOCKER_REGISTRY', defaultValue: '', description: '镜像仓库地址，为空时只生成本地镜像')
    string(name: 'IMAGE_NAME', defaultValue: 'kt-template-online-api', description: 'Docker 镜像名称')
    string(name: 'IMAGE_TAG', defaultValue: '', description: '镜像标签，为空时使用 分支名-BUILD_NUMBER')
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
          def branchTag = normalizeDockerTag(env.BRANCH_NAME ?: 'local')
          def imageTagParam = params.IMAGE_TAG?.trim()
          env.IMAGE_TAG_FINAL = imageTagParam ? normalizeDockerTag(imageTagParam) : "${branchTag}-${env.BUILD_NUMBER}"
          def registry = params.DOCKER_REGISTRY?.trim()
          env.DOCKER_IMAGE = registry ? "${registry}/${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}" : "${params.IMAGE_NAME}:${env.IMAGE_TAG_FINAL}"

          // 项目以 pnpm-lock.yaml 为准；Agent 未安装 pnpm 时再通过 Corepack 启用 pnpm 9。
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

          echo "Docker image: ${env.DOCKER_IMAGE}"
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
        expression { return params.BUILD_DOCKER_IMAGE }
      }
      steps {
        script {
          runCmd("docker build -f dockerfile -t ${env.DOCKER_IMAGE} .")
        }
      }
    }

    stage('Docker Push') {
      when {
        expression { return params.BUILD_DOCKER_IMAGE && params.PUSH_DOCKER_IMAGE }
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
