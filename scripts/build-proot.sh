#!/usr/bin/env bash
# 在 arm64 Linux 上编译静态 proot（termux fork，含 Android seccomp/SELinux 修补）。
# 产物：dist/proot（静态、内嵌 loader、不依赖 libtalloc.so）
set -euo pipefail
OUT="${OUT:-$PWD/dist}"
SRC="${SRC:-$PWD/.cache/proot}"
mkdir -p "$OUT" "$(dirname "$SRC")"

if [ ! -d "$SRC" ]; then
  git clone --depth 1 https://github.com/termux/proot.git "$SRC"
fi

sudo apt-get update -qq
sudo apt-get install -y -qq build-essential libtalloc-dev pkg-config

cd "$SRC/src"

# arm64 的 arch.h 里 HAS_LOADER_32BIT=true，会去编 32 位 loader（需要 -m32 与 armhf 库）。
# 我们只跑 arm64 的 node，不需要 32 位支持，删掉这一行即可。
sed -i '/#define HAS_LOADER_32BIT true/d' arch.h
grep -c "HAS_LOADER_32BIT" arch.h || true

# 默认目标 proot 会先构建并内嵌 loader/loader（不需要单独的 loader.elf 目标）
make -j"$(nproc)" LDFLAGS="-static -ltalloc" proot

cp -f proot "$OUT/proot"
chmod +x "$OUT/proot"
file "$OUT/proot" || true
"$OUT/proot" --version || true
ls -lh "$OUT/proot"
