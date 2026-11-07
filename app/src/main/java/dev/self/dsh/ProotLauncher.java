package dev.self.dsh;

import android.content.Context;
import android.os.Environment;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 拼 proot 启动命令并拉起 dsh web。 */
final class ProotLauncher {

    private ProotLauncher() {}

    static File prootBinary(Context ctx) {
        File f = new File(ctx.getFilesDir(), "proot/proot");
        return f;
    }


    /** 首次启动生成 ed25519 密钥（只生成一次），供 ssh vps 使用。 */
    static void ensureSshKey(Context ctx) {
        File rootfs = new RootfsManager(ctx).rootfsDir();
        File key = new File(rootfs, "root/.ssh/id_ed25519");
        if (key.isFile()) return;
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("/system/bin/env");
            cmd.add("GLIBC_TUNABLES=glibc.pthread.rseq=0");
            cmd.add("PROOT_NO_SECCOMP=1");
            cmd.add("PROOT_TMP_DIR=" + new File(ctx.getFilesDir(), "proot-tmp").getAbsolutePath());
            cmd.add(prootBinary(ctx).getAbsolutePath());
            cmd.add("--link2symlink");
            cmd.add("-0");
            cmd.add("-r"); cmd.add(rootfs.getAbsolutePath());
            cmd.add("-b"); cmd.add("/dev");
            cmd.add("-b"); cmd.add("/proc");
            cmd.add("-b"); cmd.add("/sys");
            cmd.add("-w"); cmd.add("/root");
            cmd.add("/bin/sh");
            cmd.add("-c");
            cmd.add("mkdir -p /root/.ssh && chmod 700 /root/.ssh && " +
                    "ssh-keygen -t ed25519 -N '' -C dsh-android -f /root/.ssh/id_ed25519 && " +
                    "chmod 600 /root/.ssh/id_ed25519");
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.environment().put("PROOT_TMP_DIR",
                    new File(ctx.getFilesDir(), "proot-tmp").getAbsolutePath());
            pb.environment().put("PROOT_NO_SECCOMP", "1");
            pb.environment().put("GLIBC_TUNABLES", "glibc.pthread.rseq=0");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            boolean done = p.waitFor(90, java.util.concurrent.TimeUnit.SECONDS);
            int code = done ? p.exitValue() : -1;
            // 这一步也是 proot 的自检：它跑不起来时这里最先露馅
            EngineService.log("SSH 密钥这一步 exit=" + code + (done ? "" : "（超时）"));
        } catch (Exception e) {
            EngineService.log("生成 SSH 密钥失败: " + e);
        }
    }

    static Process start(Context ctx, int port) throws IOException {
        File rootfs = new RootfsManager(ctx).rootfsDir();
        File proot = prootBinary(ctx);
        if (!proot.isFile()) throw new IOException("缺少 proot 二进制: " + proot);
        if (!proot.canExecute()) {
            //noinspection ResultOfMethodCallIgnored
            proot.setExecutable(true, false);
        }

        File tmp = new File(ctx.getFilesDir(), "proot-tmp");
        //noinspection ResultOfMethodCallIgnored
        tmp.mkdirs();

        List<String> cmd = new ArrayList<>();
        // 用 Android 自带的 /system/bin/env 显式注入环境变量，而不是只靠
        // ProcessBuilder.environment()。GLIBC_TUNABLES 必须在 exec proot 之前
        // 就位：proot 是 glibc 静态二进制，glibc 2.35+ 启动时注册 rseq，而
        // Android 10 的 seccomp 白名单没有 rseq(293)，不关掉 proot 自己先死。
        cmd.add("/system/bin/env");
        cmd.add("GLIBC_TUNABLES=glibc.pthread.rseq=0");
        cmd.add("PROOT_NO_SECCOMP=1");
        cmd.add("PROOT_TMP_DIR=" + tmp.getAbsolutePath());
        cmd.add("PROOT_LOADER=" + new File(ctx.getFilesDir(), "proot/loader").getAbsolutePath());
        cmd.add(proot.getAbsolutePath());
        cmd.add("--link2symlink");
        cmd.add("-0");                                  // fake root
        cmd.add("-r"); cmd.add(rootfs.getAbsolutePath());
        cmd.add("-b"); cmd.add("/dev");
        cmd.add("-b"); cmd.add("/proc");
        cmd.add("-b"); cmd.add("/sys");
        cmd.add("-b"); cmd.add("/apex");                // Android 10 起 linker 需要
        File ext = Environment.getExternalStorageDirectory();
        if (ext != null && ext.isDirectory()) {
            cmd.add("-b"); cmd.add(ext.getAbsolutePath() + ":/mnt/sdcard");
        }
        cmd.add("-w"); cmd.add("/root");
        cmd.add("/usr/bin/env");
        cmd.add("-i");
        cmd.add("HOME=/root");
        cmd.add("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        cmd.add("TERM=xterm-256color");
        cmd.add("LANG=C.UTF-8");
        cmd.add("LC_ALL=C.UTF-8");
        cmd.add("/usr/local/bin/node");
        cmd.add("/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js");
        cmd.add("web");
        cmd.add("--no-open");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        env.put("PROOT_TMP_DIR", tmp.getAbsolutePath());
        // 纯 ptrace 模式：proot 的 seccomp 加速器在 Android 上没用 —— 内核会把
        // 多个 seccomp filter 链起来取最严格结果，Android 的 KILL 先于 proot 的
        // TRACE 生效。只有 PTRACE_SYSCALL 才能在 seccomp 之前改掉 syscall 号。
        env.put("PROOT_NO_SECCOMP", "1");
        // proot 自己是 glibc 静态二进制，glibc 2.35+ 启动时会注册 rseq，
        // 而 Android 10 的 seccomp 白名单没有 rseq(293) —— 不关掉的话
        // proot 自己就先被 SIGSYS 杀了（退出码同样是 159）。
        env.put("GLIBC_TUNABLES", "glibc.pthread.rseq=0");
        env.put("PROOT_LOADER", new File(ctx.getFilesDir(), "proot/loader").getAbsolutePath());
        pb.directory(rootfs);
        pb.redirectErrorStream(true);
        return pb.start();
    }
}
