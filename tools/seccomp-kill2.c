#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <linux/seccomp.h>
#include <linux/filter.h>

/* 模拟 Android 老版本的 seccomp：命中 clone3 / rseq 直接 SIGSYS 杀进程。
 * 用来验证 proot 的补丁是否真的在 seccomp 之前把 syscall 改掉了。 */

#if defined(__aarch64__) || defined(__arm__)
#  define NR_RSEQ 293
#else
#  define NR_RSEQ 334
#endif
#define NR_CLONE3 435

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <cmd...>\n", argv[0]); return 2; }
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NR_CLONE3, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NR_RSEQ, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog prog = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) { perror("no_new_privs"); return 1; }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) { perror("seccomp"); return 1; }
    execvp(argv[1], argv + 1); perror("execvp"); return 127;
}
