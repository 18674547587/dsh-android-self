#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <linux/seccomp.h>
#include <linux/filter.h>

/* 用法: seccomp-kill <syscall_nr> <cmd...>  —— 命中该 syscall 即 SIGSYS kill */
int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <nr> <cmd...>\n", argv[0]); return 2; }
    int nr = atoi(argv[1]);
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, nr, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog prog = { .len = sizeof(filter)/sizeof(filter[0]), .filter = filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) { perror("no_new_privs"); return 1; }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) { perror("seccomp"); return 1; }
    execvp(argv[2], argv + 2);
    perror("execvp");
    return 127;
}
