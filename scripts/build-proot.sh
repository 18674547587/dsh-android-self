#!/usr/bin/env bash
# 用 zig(musl) 静态编译 proot（arm64）。
#
# 为什么不再用 Ubuntu 的 gcc + glibc：
#   proot 自己是静态 glibc 二进制，glibc 2.35+ 在**启动阶段**就调 rseq(293)，
#   而 Android 10 的 seccomp 白名单里没有这个号。AOSP 的 seccomp 生成器对
#   未列入白名单的 syscall 用的是 SECCOMP_RET_TRAP（不是返回 ENOSYS），
#   见 bionic/libc/seccomp/seccomp_policy.cpp 的 Disallow() —— 于是进程直接
#   收 SIGSYS，退出码 128+31 = 159。
#
#   上一版把 rseq 调用点改写成 syscall(-1) 没用：-1 同样不在白名单里，
#   照样 TRAP。真机上两个包（build-20 / build-22）都是 159。
#
#   musl 的启动路径只有 set_tid_address / brk / mmap / getpid / ioctl / writev /
#   exit_group，全部在白名单内，从根上不碰 rseq 与 clone3。
#
# 产物：dist/proot（aarch64、静态、musl）
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$PWD/dist}"
CACHE="${CACHE:-$PWD/.cache}"
SRC="${SRC:-$CACHE/proot}"
ZIG_VER="${ZIG_VER:-0.13.0}"
TALLOC_VER="${TALLOC_VER:-2.4.2-r1}"
ALPINE_VER="${ALPINE_VER:-v3.20}"
PROOT_VER="${PROOT_VER:-5.1.107}"

mkdir -p "$OUT" "$CACHE"

# --- 1. zig：自带 musl 与 aarch64 后端，单文件 45MB（NDK 要 700MB+）---
case "$(uname -m)" in
  aarch64|arm64) ZIG_ARCH=aarch64 ;;
  x86_64)        ZIG_ARCH=x86_64 ;;
  *) echo "不支持的构建机架构: $(uname -m)"; exit 1 ;;
esac
ZIG="$CACHE/zig-linux-$ZIG_ARCH-$ZIG_VER/zig"
if [ ! -x "$ZIG" ]; then
  echo "==> 下载 zig $ZIG_VER ($ZIG_ARCH)"
  curl -sL --retry 3 -o "$CACHE/zig.tar.xz" \
    "https://ziglang.org/download/$ZIG_VER/zig-linux-$ZIG_ARCH-$ZIG_VER.tar.xz"
  tar -xf "$CACHE/zig.tar.xz" -C "$CACHE"
fi
"$ZIG" version

# --- 2. libtalloc.a：用 Alpine 的 musl aarch64 静态库，省掉 waf 交叉编译 ---
TALLOC="$CACHE/talloc"
if [ ! -f "$TALLOC/usr/lib/libtalloc.a" ]; then
  echo "==> 下载 libtalloc-static $TALLOC_VER"
  rm -rf "$TALLOC"; mkdir -p "$TALLOC"
  for p in talloc-static-$TALLOC_VER talloc-dev-$TALLOC_VER; do
    curl -sL --retry 3 -o "$TALLOC/$p.apk" \
      "https://dl-cdn.alpinelinux.org/alpine/$ALPINE_VER/main/aarch64/$p.apk"
    tar -xzf "$TALLOC/$p.apk" -C "$TALLOC"
  done
fi
[ -f "$TALLOC/usr/lib/libtalloc.a" ] || { echo "libtalloc.a 缺失"; exit 1; }

# --- 3. 源码与补丁 ---
if [ ! -d "$SRC" ]; then
  git clone --depth 1 https://github.com/termux/proot.git "$SRC"
fi

echo "==> 打补丁：clone3/rseq -> ENOSYS、PR_void -> getpid"
python3 "$HERE/patch-proot.py" "$SRC"
echo "==> 打补丁：GNUmakefile 适配 zig/lld"
python3 "$HERE/patch-musl.py" "$SRC"

# arm64 的 arch.h 里 HAS_LOADER_32BIT=true 会去编 32 位 loader（要 -m32 与 armhf 库），删掉
sed -i '/#define HAS_LOADER_32BIT true/d' "$SRC/src/arch.h"

# --- 4. 编译 ---
# 构建机是 aarch64 时用系统 binutils；x86_64 时用交叉版（apt install binutils-aarch64-linux-gnu）
if [ "$(uname -m)" = "x86_64" ]; then BINUTILS="aarch64-linux-gnu-"; else BINUTILS=""; fi
STRIP="${BINUTILS}strip"; OBJCOPY="${BINUTILS}objcopy"; OBJDUMP="${BINUTILS}objdump"
for t in "$STRIP" "$OBJCOPY" "$OBJDUMP"; do
  command -v "$t" >/dev/null || { echo "缺少 $t（apt install binutils-aarch64-linux-gnu）"; exit 1; }
done

cd "$SRC/src"
make clean >/dev/null 2>&1 || true
echo "==> 编译 proot（musl static, aarch64）"
make -j"$(nproc)" \
  CC="$ZIG cc -target aarch64-linux-musl" \
  LOADER_LD="$ZIG ld.lld" \
  STRIP="$STRIP" OBJCOPY="$OBJCOPY" OBJDUMP="$OBJDUMP" \
  CPPFLAGS="-I. -I$HERE/musl-compat -I$TALLOC/usr/include -D_GNU_SOURCE -DARG_MAX=131072 -DVERSION=\"$PROOT_VER\" -include $HERE/musl-compat/compat.h" \
  LDFLAGS="-static -L$TALLOC/usr/lib -ltalloc" \
  proot

cp -f proot "$OUT/proot"
chmod +x "$OUT/proot"
# 2.8MB -> 485KB；不影响功能
"$STRIP" "$OUT/proot"

echo "==> 校验"
file "$OUT/proot"
"$OUT/proot" --version || true
ls -lh "$OUT/proot"
chmod -R a+rX "$OUT" 2>/dev/null || true
