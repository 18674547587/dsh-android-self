#!/usr/bin/env python3
"""给 termux/proot 打补丁：把 clone3 / rseq 变成返回 ENOSYS。

为什么：Android（尤其 10 及更早）的 seccomp 是「白名单 + 未命中即
SIGSYS 杀进程」，而名单是照着当时内核的 syscall 表生成的。clone3 要
内核 5.3、rseq 要 4.18，所以老 Android 上这两个号根本不在名单里。
偏偏 Ubuntu 24.04 的 glibc 2.39 启动时就会注册 rseq、pthread_create
时先试 clone3，于是 rootfs 里所有 glibc 程序都活不过初始化
（实测：node 一启动就 128+31 = 退出码 159）。

glibc 对两者都有 ENOSYS 回退路径（clone3 -> clone，rseq 直接跳过），
所以在 proot 的 syscall-enter 阶段伪造 ENOSYS 即可，rootfs 一行不用改。

用法: patch-proot.py <proot 源码根目录>
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
changed = []


def sub(path, old, new, must=True):
    p = ROOT / path
    if not p.exists():
        if must:
            sys.exit(f"patch 失败：找不到 {path}")
        return
    s = p.read_text()
    if new in s:
        print(f"  跳过（已打过） {path}")
        return
    if s.count(old) != 1:
        sys.exit(f"patch 失败：{path} 里锚点出现 {s.count(old)} 次\n{old[:300]}")
    p.write_text(s.replace(old, new, 1))
    changed.append(path)
    print(f"  patched {path}")


# 1) 枚举里补一个 PR_rseq（放末尾，不打乱已有枚举值）
sub("src/syscall/sysnums.list",
    "SYSNUM(x32_writev)\n",
    "SYSNUM(x32_writev)\nSYSNUM(rseq)\n")

# 2) 架构 syscall 号表：arm64 = 293，x86_64/x32 = 334
for hdr, nr in [("src/syscall/sysnums-arm64.h", 293),
                ("src/syscall/sysnums-x86_64.h", 334),
                ("src/syscall/sysnums-x32.h", 334)]:
    p = ROOT / hdr
    if not p.exists():
        continue
    s = p.read_text()
    if f"[ {nr} ] = PR_rseq," in s:
        print(f"  跳过（已打过） {hdr}")
        continue
    m = re.search(r"^[ \t]*\[ 435 \] = PR_clone3,\n", s, re.M)
    if not m:
        print(f"  警告：{hdr} 里没有 clone3 锚点，跳过")
        continue
    anchor = m.group(0)
    indent = anchor[:len(anchor) - len(anchor.lstrip())]
    p.write_text(s.replace(anchor, anchor + f"{indent}[ {nr} ] = PR_rseq,\n", 1))
    changed.append(hdr)
    print(f"  patched {hdr}")

# 3) proot 自己的 seccomp 加速器也要能看到 rseq，否则加速模式下
#    proot 不会在 rseq 上停下来，补丁形同虚设
sub("src/syscall/seccomp.c",
    "\t{ PR_clone3,\t\t0 },\n",
    "\t{ PR_clone3,\t\t0 },\n\t{ PR_rseq,\t\t0 },\n")

# 4) enter 阶段伪造 ENOSYS
CLONE3_OLD = """\tcase PR_clone3: {
\t\tword_t args_addr = peek_reg(tracee, CURRENT, SYSARG_1);
\t\tword_t flags;

\t\tif (args_addr != 0) {
\t\t\terrno = 0;
\t\t\tflags = peek_word(tracee, args_addr);
\t\t\tif (errno == 0 && (flags & CLONE_NS_MASK) != 0) {
\t\t\t\tif ((flags & CLONE_NEWNS) != 0)
\t\t\t\t\ttracee->clone_stripped_newns = true;
\t\t\t\tif ((flags & CLONE_NEWNET) != 0)
\t\t\t\t\ttracee->clone_stripped_newnet = true;
\t\t\t\tpoke_word(tracee, args_addr,
\t\t\t\t\t  flags & ~(word_t) CLONE_NS_MASK);
\t\t\t}
\t\t}
\t\tforce_fork_sysexit(tracee);
\t\tstatus = 0;
\t\tbreak;
\t}
"""

CLONE3_NEW = """\t/* Android（尤其 10 及更早）的 seccomp 白名单里没有 clone3(2)：
\t * 该 syscall 要内核 5.3 才有，名单是照着当时的 syscall 表生成的，
\t * 一调用就 SIGSYS 杀进程。而 glibc 2.34+ 的 pthread_create 是
\t * 「先试 clone3，拿到 ENOSYS 才回退 clone」，于是 rootfs 里所有
\t * 多线程 glibc 程序都活不过初始化（实测 Ubuntu 24.04 上 node 的
\t * 退出码 159 = 128 + SIGSYS）。这里直接伪造 ENOSYS 让 glibc 回退。
\t * 顺带说明：原来的 CLONE_NEW* 剥离逻辑也就不需要了，因为
\t * clone3 不会再走到内核。 */
\tcase PR_clone3:
\t\tpoke_reg(tracee, SYSARG_RESULT, (word_t) -ENOSYS);
\t\tset_sysnum(tracee, PR_void);
\t\tstatus = 0;
\t\tbreak;
"""

RSEQ_NEW = """\t/* 同上：rseq(2) 要内核 4.18，Android 10 的 seccomp 名单里也没有。
\t * glibc 2.35+ 在程序启动阶段就注册 rseq，被 SIGSYS 杀掉；伪造
\t * ENOSYS 后 glibc 跳过注册，功能不受影响。 */
\tcase PR_rseq:
\t\tpoke_reg(tracee, SYSARG_RESULT, (word_t) -ENOSYS);
\t\tset_sysnum(tracee, PR_void);
\t\tstatus = 0;
\t\tbreak;

"""

sub("src/syscall/enter.c", CLONE3_OLD, CLONE3_NEW)
sub("src/syscall/enter.c", "\tcase PR_fork:\n", RSEQ_NEW + "\tcase PR_fork:\n")

# 5) proot 伪造 ENOSYS 的手法是把 syscall 号改成 PR_void（枚举值 0 = io_setup）。
#    Android 10 的 seccomp 白名单里不一定有 io_setup，但一定有 getpid，所以把
#    PR_void 挪到 172：内核执行的是无害的 getpid，返回值由 proot 在 exit 阶段覆盖。
sub("src/syscall/sysnums-arm64.h", "\t[ 0 ] = PR_io_setup,\n", "\t[ 0 ] = PR_getpid,\n")
sub("src/syscall/sysnums-arm64.h", "\t[ 172 ] = PR_getpid,\n", "\t[ 172 ] = PR_void,\n")

print(f"完成，改动 {len(changed)} 个文件")
