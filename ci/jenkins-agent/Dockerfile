FROM jenkins/inbound-agent:latest-jdk21

USER root

ARG NODE_MAJOR=22
ARG PNPM_VERSION=9

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
  && node --version \
  && pnpm --version \
  && docker --version \
  && docker compose version \
  && rm -rf /var/lib/apt/lists/*

USER jenkins
