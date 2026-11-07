#!/usr/bin/env bash
# 在 arm64 Linux 上编译静态 proot（termux fork，含 Android seccomp/SELinux 修补）。
# 产物：dist/proot（静态、内嵌 loader、不依赖 libtalloc.so）
set -euo pipefail
# 后面会 cd 到源码目录，先把脚本所在目录记成绝对路径
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$PWD/dist}"
SRC="${SRC:-$PWD/.cache/proot}"
mkdir -p "$OUT" "$(dirname "$SRC")"

if [ ! -d "$SRC" ]; then
  git clone --depth 1 https://github.com/termux/proot.git "$SRC"
fi

sudo apt-get update -qq
sudo apt-get install -y -qq build-essential libtalloc-dev pkg-config

# Android 10 及更早的 seccomp 白名单里没有 clone3(435)/rseq(293)，命中即
# SIGSYS 杀进程；而 Ubuntu 24.04 的 glibc 2.39 两者都会用（实测 node 一启动
# 就 128+31=159）。补丁把它们在 proot 里改成返回 ENOSYS，让 glibc 走回退路径。
echo "==> 打补丁：clone3/rseq -> ENOSYS"
python3 "$HERE/patch-proot.py" "$SRC"

cd "$SRC/src"

# arm64 的 arch.h 里 HAS_LOADER_32BIT=true，会去编 32 位 loader（需要 -m32 与 armhf 库）。
# 我们只跑 arm64 的 node，不需要 32 位支持，删掉这一行即可。
sed -i '/#define HAS_LOADER_32BIT true/d' arch.h
grep -c "HAS_LOADER_32BIT" arch.h || true

# 默认目标 proot 会先构建并内嵌 loader/loader（不需要单独的 loader.elf 目标）
make -j"$(nproc)" LDFLAGS="-static -ltalloc" proot

cp -f proot "$OUT/proot"
chmod +x "$OUT/proot"

# proot 自己是 glibc 静态二进制，glibc 2.35+ 启动时会调 rseq，而 Android 老版本
# 的 seccomp 白名单没有这个号 —— 不把调用点改掉的话 proot 自己就先 SIGSYS 了。
echo "==> 打二进制补丁：rseq 调用 -> syscall(-1)"
python3 "$HERE/patch-proot-bin.py" "$OUT/proot"
file "$OUT/proot" || true
"$OUT/proot" --version || true
ls -lh "$OUT/proot"
chmod -R a+rX "$OUT" 2>/dev/null || true
