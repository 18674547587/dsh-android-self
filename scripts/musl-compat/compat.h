#ifndef __ASSEMBLER__
/* musl 缺 glibc 的 64 位别名（arm64 上本来就只有 64 位实现） */
#include <sys/resource.h>
#include <sys/vfs.h>
#define rlimit64 rlimit
#define getrlimit64 getrlimit
#define setrlimit64 setrlimit
#define statfs64 statfs
#define fstatfs64 fstatfs
/* Linux 内核的 msgrcv 标志，musl 的 sys/msg.h 没导出 */
#include <sys/msg.h>
#ifndef MSG_COPY
#define MSG_COPY 040000
#endif
#ifndef MSG_EXCEPT
#define MSG_EXCEPT 020000
#endif
/* glibc 的 EINTR 重试宏 */
#include <errno.h>
#ifndef TEMP_FAILURE_RETRY
#define TEMP_FAILURE_RETRY(expr) \
    ({ long int __r; do { __r = (long int)(expr); } while (__r == -1L && errno == EINTR); __r; })
#endif

#endif /* __ASSEMBLER__ */
