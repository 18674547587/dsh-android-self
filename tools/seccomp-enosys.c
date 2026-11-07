#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <linux/seccomp.h>
#include <linux/filter.h>
#include <linux/errno.h>
/* 对 clone3(435) / rseq(334) 返回 ENOSYS，其余放行 —— 模拟修复后的行为 */
int main(int argc, char **argv) {
    if (argc < 2) return 2;
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 435, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 334, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog prog = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) { perror("seccomp"); return 1; }
    execvp(argv[1], argv + 1); perror("execvp"); return 127;
}
