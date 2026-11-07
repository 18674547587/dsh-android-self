#!/usr/bin/env bash
# 冒烟测试：在 arm64 runner 上复现 Android 老版本的 seccomp（clone3/rseq 命中即
# SIGSYS 杀进程），验证打完补丁的 proot 仍能把 node 拉起来。
# 不通过就直接失败，免得又出一个「装上去退出码 159」的 APK。
set -euo pipefail
OUT="${OUT:-$PWD/dist}"
ROOT="${ROOT:-$PWD/rootfs}"
# 注意：传给 proot 的必须是 guest 内的路径（/usr/local/bin/node），
# 不是 host 上的 $ROOT/usr/local/bin/node —— proot 不会替你翻译。
NODE=/usr/local/bin/node

[ -x "$OUT/proot" ]  || { echo "缺少 $OUT/proot"; exit 1; }
[ -x "$ROOT$NODE" ]  || { echo "缺少 rootfs 里的 node: $ROOT$NODE"; exit 1; }

gcc -O2 -o /tmp/seccomp-kill2 tools/seccomp-kill2.c

echo "==> 检查 proot 是 musl 静态二进制（不依赖 glibc 的 rseq 启动路径）"
file "$OUT/proot"
"$OUT/proot" --version | head -2

echo "==> 探针 0：proot 在 seccomp 下能起来吗（**故意不给 GLIBC_TUNABLES**）"
/tmp/seccomp-kill2 "$OUT/proot" --version >/dev/null

echo "==> 探针 1：node 单线程"
GLIBC_TUNABLES=glibc.pthread.rseq=0 PROOT_NO_SECCOMP=1 \
  /tmp/seccomp-kill2 "$OUT/proot" -0 -r "$ROOT" -b /dev -b /proc -b /sys -w /root \
    /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin \
    "$NODE" -e 'console.log("smoke: node ok", process.version)'

echo "==> 探针 2：worker_threads（真正会走 pthread_create 的那条路）"
GLIBC_TUNABLES=glibc.pthread.rseq=0 PROOT_NO_SECCOMP=1 \
  /tmp/seccomp-kill2 "$OUT/proot" -0 -r "$ROOT" -b /dev -b /proc -b /sys -w /root \
    /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin \
    "$NODE" -e 'const {Worker}=require("worker_threads");let n=0;for(let i=0;i<4;i++){new Worker("setTimeout(()=>{},50)",{eval:true}).on("exit",()=>{if(++n===4)console.log("smoke: 4 workers ok")})}'

echo "==> 探针 3：bash + git"
GLIBC_TUNABLES=glibc.pthread.rseq=0 PROOT_NO_SECCOMP=1 \
  /tmp/seccomp-kill2 "$OUT/proot" -0 -r "$ROOT" -b /dev -b /proc -b /sys -w /root \
    /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin \
    bash -c 'echo "smoke: bash ok"; git --version'

echo "冒烟测试全部通过"
