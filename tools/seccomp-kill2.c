#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <linux/seccomp.h>
#include <linux/filter.h>

/* 模拟 Android 10 的 seccomp 行为。
 *
 * 关键事实：Android 的 seccomp 对**未列入白名单**的 syscall 是
 * SECCOMP_RET_TRAP（SIGSYS），不是返回 ENOSYS —— 见 AOSP
 * bionic/libc/seccomp/seccomp_policy.cpp 里的 Disallow()。
 * 所以退出码 128+31 = 159。
 *
 * 这里用「号 >= 400 一律 TRAP」来近似「白名单外」：Android 10 的内核是
 * 4.14/4.19，syscall 最大号约 290，400 以上的号在它的白名单里一个都没有。
 * 这样一来：
 *   - rseq(293)、clone3(435) 会被拦；
 *   - 把 rseq 改写成 syscall(-1) 也会被拦（-1 当 u32 就是 0xFFFFFFFF >= 400），
 *     这正是上一版补丁在真机上仍然 159 的原因。
 */

#define NR_RSEQ     293
#define NR_MEMBARRIER 283
#define NR_FIRST_NEW 400

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <cmd...>\n", argv[0]); return 2; }
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        /* 新 syscall 号（含 -1 = 0xFFFFFFFF）→ TRAP */
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, NR_FIRST_NEW, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP),
        /* Android 10 白名单里确实没有的几条 */
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NR_RSEQ, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NR_MEMBARRIER, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRAP),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog prog = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) { perror("no_new_privs"); return 1; }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) { perror("seccomp"); return 1; }
    execvp(argv[1], argv + 1); perror("execvp"); return 127;
}
