#!/usr/bin/env bash
# 在 arm64 Linux 上编译静态 proot（termux fork，含 Android seccomp/SELinux 相关修补）。
# 产物：dist/proot（静态、无 libtalloc 依赖）
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
make -j"$(nproc)" loader.elf
# 静态链接：termux fork 的 Makefile 支持 LDFLAGS 覆盖
make -j"$(nproc)" LDFLAGS="-static -ltalloc" proot || make -j"$(nproc)" LDFLAGS="-static" proot

cp -f proot "$OUT/proot"
# proot 需要配套 loader（非静态部分），一并带走
if [ -f loader.elf ]; then cp -f loader.elf "$OUT/loader"; fi
ls -lh "$OUT" | sed -n '1,10p' 
chmod +x "$OUT/proot"
file "$OUT/proot" || true
"$OUT/proot" --version || true
ls -lh "$OUT/proot"
