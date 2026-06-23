ARG NAPCAT_BASE_IMAGE=
FROM ${NAPCAT_BASE_IMAGE}

USER root

RUN set -eux; \
  apt-get update; \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    dbus-x11 \
    fontconfig \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    locales \
    tzdata \
    unzip \
    zip \
    xdg-utils; \
  sed -i 's/^# *zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen; \
  locale-gen zh_CN.UTF-8; \
  ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime; \
  echo Asia/Shanghai > /etc/timezone; \
  fc-cache -fv; \
  rm -rf /var/lib/apt/lists/*

COPY NapCat.Shell /tmp/NapCat.Shell
COPY ci/napcat-desktop-cn/fork-artifact.json /ci/napcat-desktop-cn/fork-artifact.json
RUN set -eux; \
  cd /tmp/NapCat.Shell; \
  zip -qr /app/NapCat.Shell.zip .; \
  sha256sum /app/NapCat.Shell.zip | awk '{print $1}' > /ci/napcat-desktop-cn/NapCat.Shell.zip.sha256; \
  rm -rf /tmp/NapCat.Shell
COPY ci/napcat-desktop-cn/verify.sh /ci/napcat-desktop-cn/verify.sh
RUN sed -i 's/\r$//' /ci/napcat-desktop-cn/verify.sh && chmod +x /ci/napcat-desktop-cn/verify.sh

ENV LANG=zh_CN.UTF-8 \
  LC_ALL=zh_CN.UTF-8 \
  LANGUAGE=zh_CN:zh \
  TZ=Asia/Shanghai \
  HOME=/app \
  XDG_CONFIG_HOME=/app/.config \
  XDG_CACHE_HOME=/app/.cache \
  XDG_DATA_HOME=/app/.local/share \
  XDG_RUNTIME_DIR=/tmp/runtime-napcat
