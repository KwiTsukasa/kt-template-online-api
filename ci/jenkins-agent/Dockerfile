FROM jenkins/inbound-agent:latest-jdk21

USER root

ARG NODE_MAJOR=22
ARG PNPM_VERSION=9
ARG KUBECTL_VERSION=stable
ARG GIT_SSH_HOST=github.com

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gnupg openssh-client \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && . /etc/os-release \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs docker-ce-cli docker-buildx-plugin docker-compose-plugin \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64|arm64) ;; armhf) ARCH=arm ;; *) echo "Unsupported kubectl architecture: $ARCH" >&2; exit 1 ;; esac \
  && KUBECTL_VERSION_RESOLVED="${KUBECTL_VERSION}" \
  && if [ "${KUBECTL_VERSION}" = "stable" ]; then KUBECTL_VERSION_RESOLVED="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"; fi \
  && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION_RESOLVED}/bin/linux/${ARCH}/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && node --version \
  && pnpm --version \
  && docker --version \
  && docker compose version \
  && kubectl version --client=true \
  && mkdir -p /root/.ssh /home/jenkins/.ssh /etc/ssh \
  && ssh-keyscan -t rsa,ecdsa,ed25519 ${GIT_SSH_HOST} | tee /etc/ssh/ssh_known_hosts /root/.ssh/known_hosts /home/jenkins/.ssh/known_hosts >/dev/null \
  && chmod 700 /root/.ssh /home/jenkins/.ssh \
  && chmod 644 /root/.ssh/known_hosts /home/jenkins/.ssh/known_hosts \
  && chmod 644 /etc/ssh/ssh_known_hosts \
  && chown -R jenkins:jenkins /home/jenkins/.ssh \
  && rm -rf /var/lib/apt/lists/*

USER jenkins
