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
    tzdata; \
  sed -i 's/^# *zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen; \
  locale-gen zh_CN.UTF-8; \
  ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime; \
  echo Asia/Shanghai > /etc/timezone; \
  fc-cache -fv; \
  rm -rf /var/lib/apt/lists/*

ENV LANG=zh_CN.UTF-8 \
  LC_ALL=zh_CN.UTF-8 \
  LANGUAGE=zh_CN:zh \
  TZ=Asia/Shanghai \
  HOME=/app \
  XDG_CONFIG_HOME=/app/.config \
  XDG_CACHE_HOME=/app/.cache \
  XDG_DATA_HOME=/app/.local/share \
  XDG_RUNTIME_DIR=/tmp/runtime-napcat
