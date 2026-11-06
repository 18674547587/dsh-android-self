#!/usr/bin/env bash
# 在 arm64 Linux（GitHub Actions ubuntu-24.04-arm）上以 root 运行，产出自带 dsh 的 Ubuntu rootfs。
# 产物：dist/rootfs.tar.gz（含权限/符号链接），供 APK assets 使用。
set -euo pipefail

UBUNTU_VER="${UBUNTU_VER:-24.04.3}"
NODE_VER="${NODE_VER:-22.20.0}"
DSH_VER="${DSH_VER:-0.2.1-rc.2}"
OUT="${OUT:-$PWD/dist}"
ROOT="${ROOT:-$PWD/rootfs}"
mkdir -p "$OUT"

echo "==> 1/6 取 Ubuntu base ($UBUNTU_VER arm64)"
if [ ! -f ubuntu-base.tar.gz ]; then
  curl -fsSL -o ubuntu-base.tar.gz \
    "https://cdimage.ubuntu.com/ubuntu-base/releases/${UBUNTU_VER%.*}/release/ubuntu-base-${UBUNTU_VER}-base-arm64.tar.gz"
fi
rm -rf "$ROOT"; mkdir -p "$ROOT"
tar -xzf ubuntu-base.tar.gz -C "$ROOT"

echo "==> 2/6 准备 chroot 挂载"
cp -f /etc/resolv.conf "$ROOT/etc/resolv.conf"
mount -t proc  proc  "$ROOT/proc" 2>/dev/null || true
mount -t sysfs sys   "$ROOT/sys"  2>/dev/null || true
mount --bind  /dev   "$ROOT/dev"  2>/dev/null || true
trap 'umount -R "$ROOT/proc" "$ROOT/sys" "$ROOT/dev" 2>/dev/null || true' EXIT

echo "==> 3/6 chroot 内装基础包"
chroot "$ROOT" /usr/bin/env -i \
  DEBIAN_FRONTEND=noninteractive HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -euxo pipefail -c '
    apt-get update
    apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils git ripgrep python3 build-essential \
      procps less file tzdata locales sudo openssh-client
    apt-get clean; rm -rf /var/lib/apt/lists/*
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
'

echo "==> 4/6 chroot 内装 Node $NODE_VER（官方 glibc arm64 包）"
chroot "$ROOT" /usr/bin/env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -euxo pipefail -c "
    curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-arm64.tar.xz
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    rm -f /tmp/node.tar.xz
    /usr/local/bin/node -v && /usr/local/bin/npm -v
"

echo "==> 5/6 chroot 内装 dsh $DSH_VER（会就地编译 node-pty 等原生模块）"
chroot "$ROOT" /usr/bin/env -i \
  HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
  /bin/bash -euxo pipefail -c "
    npm install -g @deepseek-ai/dsh@${DSH_VER}
    ls -l /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
"

echo "==> 6/6 清理并打包"
rm -rf "$ROOT"/tmp/* "$ROOT"/root/.npm "$ROOT"/root/.cache 2>/dev/null || true
# proot 下 getuid 恒为 0，/etc/passwd 需有 root 项（base 镜像自带）
tar -C "$ROOT" --numeric-owner -czf "$OUT/rootfs.tar.gz" .
ls -lh "$OUT/rootfs.tar.gz"
echo "完成：$OUT/rootfs.tar.gz"
