#!/usr/bin/env bash
# 在 arm64 Linux（GitHub Actions ubuntu-24.04-arm）上以 root 运行。
# 产出一个「apt 长期可用、能随手装工具」的 Ubuntu rootfs，内含 Node + dsh。
set -euo pipefail

UBUNTU_VER="${UBUNTU_VER:-24.04.3}"
NODE_VER="${NODE_VER:-24.22.2}"
DSH_VER="${DSH_VER:-0.2.2-rc.1}"
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
mount -t proc  proc "$ROOT/proc" 2>/dev/null || true
mount -t sysfs sys  "$ROOT/sys"  2>/dev/null || true
mount --bind  /dev  "$ROOT/dev"  2>/dev/null || true
trap 'umount -R "$ROOT/proc" "$ROOT/sys" "$ROOT/dev" 2>/dev/null || true' EXIT

# proot 里没有 systemd：任何 postinst 想启服务都必须挡掉，否则 apt 会卡住或报错
printf '#!/bin/sh\nexit 101\n' > "$ROOT/usr/sbin/policy-rc.d"
chmod +x "$ROOT/usr/sbin/policy-rc.d"

echo "==> 3/6 chroot 内装基础工具（目标是能长期 apt，而不是只够跑 dsh）"
chroot "$ROOT" /usr/bin/env -i \
  DEBIAN_FRONTEND=noninteractive HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -euxo pipefail -c '
    apt-get update
    apt-get install -y --no-install-recommends \
      ca-certificates curl wget xz-utils zstd unzip zip tar \
      git git-lfs ripgrep fd-find jq tree less file procps psmisc \
      python3 python3-pip python3-venv pipx \
      build-essential pkg-config cmake autoconf automake libtool \
      openssh-client rsync nano vim-tiny tmux htop ncdu \
      tzdata locales sudo bash-completion
    apt-get clean
    # lists 实测 206MB，压缩后仍占几十 MB；删掉，改用 apti（自动 update 再装）
    rm -rf /var/lib/apt/lists/*
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
    echo "C.UTF-8 UTF-8" > /etc/locale.gen
    locale-gen || true
    ln -sf /usr/bin/fdfind /usr/local/bin/fd || true
    printf "export PATH=/usr/local/bin:\$PATH\n" > /etc/profile.d/10-node.sh
    # apt lists 保留：装完即可直接 apt install，不必先 update
    du -sh /var/lib/apt/lists
'

echo "==> 4/6 chroot 内装 Node $NODE_VER（官方 glibc arm64 包）"
chroot "$ROOT" /usr/bin/env -i HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -euxo pipefail -c "
    curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-arm64.tar.xz
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    rm -f /tmp/node.tar.xz
    /usr/local/bin/node -v && /usr/local/bin/npm -v
"

echo "==> 5/6 chroot 内装 dsh $DSH_VER（会就地编译 node-pty 等原生模块）"
chroot "$ROOT" /usr/bin/env -i HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
  /bin/bash -euxo pipefail -c "
    npm install -g @deepseek-ai/dsh@${DSH_VER}
    ls -l /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
    # 顺手把 pnpm 也装上：apt 装不出来的 Node 生态工具，这里一次性备好
    npm install -g pnpm@latest
    npm cache clean --force || true
"

echo "==> 5.2/6 瘦身：清掉编译工具链与文档（apti 可随时装回）"
chroot "$ROOT" /usr/bin/env -i HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  DEBIAN_FRONTEND=noninteractive \
  /bin/bash -euxo pipefail -c '
    # dsh 的 node-pty 已经编好了，编译器不再需要；用户要装东西时 apti 会装回
    apt-get purge -y build-essential gcc g++ make cmake autoconf automake libtool pkg-config cpp
    apt-get autoremove -y
    apt-get clean
    rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /usr/share/info/* /var/cache/* /tmp/*
    rm -rf /usr/share/locale/* || true
    # node_modules 里的文档/类型/映射/测试对运行无用（实测 rootfs 未压缩 1.5G，主要在这）
    NM=/usr/local/lib/node_modules
    find $NM -name "*.md" -delete 2>/dev/null || true
    find $NM -name "*.map" -delete 2>/dev/null || true
    find $NM -name "*.d.ts" -delete 2>/dev/null || true
    find $NM -type d \( -name test -o -name tests -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} + 2>/dev/null || true
    find $NM -name "*.ts" ! -name "*.d.ts" -delete 2>/dev/null || true
    echo "--- 瘦身后占用 ---"
    du -sh /usr /usr/local /root 2>/dev/null
    du -sh / 2>/dev/null || true
'

# 手机端装工具的统一入口（lists 已删，自动先 update）
cat > "$ROOT/usr/local/bin/apti" <<'EOS'
#!/bin/sh
# 用法: apti git tmux   —— 自动 apt update 后安装
set -e
apt-get update -qq
exec apt-get install -y --no-install-recommends "$@"
EOS
chmod +x "$ROOT/usr/local/bin/apti"

echo "==> 5.5/6 预置 SSH 客户端配置（方案 A：手机直接 ssh 到 VPS）"
mkdir -p "$ROOT/root/.ssh"
chmod 700 "$ROOT/root/.ssh"
cat > "$ROOT/root/.ssh/config" <<'SSHCFG'
Host vps
    HostName 8.216.42.211
    User AI
    Port 22
    IdentityFile /root/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
    TCPKeepAlive yes

Host *
    StrictHostKeyChecking accept-new
    HashKnownHosts no
SSHCFG
# 预置 VPS 主机公钥，避免首次连接卡在 yes/no 交互
echo '8.216.42.211 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOEZmCaksdieUxb6/1GsFzNXsBT3MqRnre6dGUxyuWCJ' > "$ROOT/root/.ssh/known_hosts"
chmod 600 "$ROOT/root/.ssh/config" "$ROOT/root/.ssh/known_hosts"

echo "==> 5.6/6 安装移动端适配插件 dsh-mobile-adapt"
DSH_HOME_DIR="$ROOT/root/.dsh"
mkdir -p "$DSH_HOME_DIR/profiles/node_modules" "$DSH_HOME_DIR/profiles/web"
rm -rf "$DSH_HOME_DIR/profiles/node_modules/dsh-mobile-adapt"
cp -r "$PWD/rootfs-overlay/dsh-mobile-adapt" "$DSH_HOME_DIR/profiles/node_modules/"
# 两个层级都写：profile 层是文档里的正式位置，home 层兜底（不同版本 profile 名可能不同）
printf -- "- insert:\n    - id: mobile-adapt\n      name: 'dsh-mobile-adapt'\n" \
  | tee "$DSH_HOME_DIR/profiles/web/cordis.patch.yml" > "$DSH_HOME_DIR/cordis.patch.yml"
find "$DSH_HOME_DIR" -maxdepth 4 | sed 's/^/    /'

echo "==> 5.7/6 冒烟测试：chroot 里真起一次 dsh web（失败不阻断构建，只留诊断）"
set +e
chroot "$ROOT" /usr/bin/env -i HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -c '
    cd /root
    /usr/local/bin/node /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open > /tmp/smoke.log 2>&1 &
    PID=$!
    OK=0
    for i in $(seq 1 45); do
      sleep 1
      if (exec 3<>/dev/tcp/127.0.0.1/3080) 2>/dev/null; then echo "SMOKE_OK ${i}s"; OK=1; break; fi
    done
    [ "$OK" = 0 ] && echo "SMOKE_FAIL 端口未起来"
    echo "--- HTTP 状态 ---"
    TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" /tmp/smoke.log | head -1 | cut -d= -f2)
    echo "token=${TOKEN:0:8}…"
    curl -s -o /dev/null -w "root=%{http_code}\n" "http://127.0.0.1:3080/?token=$TOKEN" 2>/dev/null
    curl -s -o /dev/null -w "plugin=%{http_code}\n" "http://127.0.0.1:3080/plugins/dsh-mobile-adapt/client.js?token=$TOKEN" 2>/dev/null
    echo "--- 插件是否进 loader（看 cordis 输出）---"
    grep -i "mobile-adapt\|plugin" /tmp/smoke.log | head -10
    echo "--- ~/.dsh 结构 ---"
    find /root/.dsh -maxdepth 3 2>/dev/null | head -40
    echo "--- 日志尾部 ---"
    tail -40 /tmp/smoke.log 2>/dev/null
    kill $PID 2>/dev/null
    wait 2>/dev/null
'
set -e

echo "==> 6/6 卸载挂载点、清理并打包"
umount -R "$ROOT/proc" "$ROOT/sys" "$ROOT/dev" 2>/dev/null || true
trap - EXIT
rm -rf "$ROOT"/tmp/* "$ROOT"/root/.npm "$ROOT"/root/.cache 2>/dev/null || true
tar -C "$ROOT" --numeric-owner -czf "$OUT/rootfs.tar.gz" .
ls -lh "$OUT/rootfs.tar.gz"
# rootfs 是 root 拥有的（含 700 的 /root），留着会让后续 setup-gradle 扫描工作区时报 EACCES
rm -rf "$ROOT"
chmod -R a+rX "$OUT" 2>/dev/null || true
echo "完成：$OUT/rootfs.tar.gz"
