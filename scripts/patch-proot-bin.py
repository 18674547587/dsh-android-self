#!/usr/bin/env python3
"""给编译好的 proot 静态二进制打补丁：把 glibc 的 rseq 注册调用改成 syscall(-1)。

为什么：proot 自己是 glibc 静态二进制，glibc 2.35+ 在**程序启动阶段**就会调
rseq(arm64=293 / x86_64=334)，而 Android 10 及更早的 seccomp 白名单里没有这个
号 —— 命中即 SIGSYS，proot 自己先死，App 里看到的就是「已退出 (159)」。

改成 syscall(-1) 之后：内核不认识 -1，直接返回 ENOSYS，glibc 当作「内核不支持
rseq」跳过注册；而 -1 这个号超出了 Android seccomp 名单的范围，BPF 里对超范围
的号是放行的（否则内核自己加新 syscall 时会被误杀）。

这比 GLIBC_TUNABLES 可靠：不依赖环境变量能不能传进 proot 进程。
"""
import pathlib
import sys

PATTERNS = [
    # x86_64: mov eax, 334 ; syscall   ->  mov eax, -1 ; syscall
    (b"\xb8\x4e\x01\x00\x00\x0f\x05", b"\xb8\xff\xff\xff\xff\x0f\x05", "x86_64 mov eax,334; syscall"),
    # arm64: movz x8, #293 ; svc #0    ->  movn x8, #0 ; svc #0
    (b"\xa8\x24\x80\xd2\x01\x00\x00\xd4", b"\x08\x00\x80\x92\x01\x00\x00\xd4", "arm64 movz x8,#293; svc"),
    # arm64 32 位变体
    (b"\xa8\x24\x80\x52\x01\x00\x00\xd4", b"\x08\x00\x80\x12\x01\x00\x00\xd4", "arm64 movz w8,#293; svc"),
]

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/proot")
data = path.read_bytes()
total = 0
for old, new, desc in PATTERNS:
    n = data.count(old)
    if n:
        data = data.replace(old, new)
        total += n
        print(f"  {desc}: 替换 {n} 处")

if total == 0:
    # 静默放行会造出一个「装上去还是 159」的 APK，宁可让构建失败
    sys.exit("找不到 rseq 调用点 —— glibc 的调用方式可能变了，需要重新确认")

path.write_bytes(data)
print(f"rseq 调用点共替换 {total} 处 -> {path}")
