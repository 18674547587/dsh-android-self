package dev.self.dsh;

import android.content.Context;
import android.os.Environment;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
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

    /**
     * proot 自己的临时目录。必须在**任何**一次 proot 调用之前就存在：
     * proot 会把内嵌的 loader 解到 PROOT_TMP_DIR 再 execve 它，
     * 目录不存在时 extract_loader() 返回 NULL，execve 直接 ENOENT。
     */
    static File tmpDir(Context ctx) {
        File tmp = new File(ctx.getFilesDir(), "proot-tmp");
        if (!tmp.isDirectory()) tmp.mkdirs();
        return tmp;
    }

    /** 首次启动生成 ed25519 密钥（只生成一次），供 ssh vps 使用。 */
    static boolean ensureSshKey(Context ctx) {
        File rootfs = new RootfsManager(ctx).rootfsDir();
        File key = new File(rootfs, "root/.ssh/id_ed25519");
        if (key.isFile()) return true;
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("/system/bin/env");
            cmd.add("PROOT_NO_SECCOMP=1");
            cmd.add("PROOT_TMP_DIR=" + tmpDir(ctx).getAbsolutePath());
            // 注意：绝不能设 PROOT_LOADER。proot 的 get_loader_path() 是
            //   getenv("PROOT_LOADER") ?: extract_loader(...)
            // 一旦这个环境变量指向不存在的文件，proot 会把 execve 的路径参数
            // 换成那个不存在的 loader，于是报
            //   proot error: execve("/bin/sh"): No such file or directory
            // —— 看起来像 rootfs 缺文件，实际是 loader 找不到。
            // 我们的 proot 是 bundled 版（GNUmakefile 里没定义 PROOT_UNBUNDLE_LOADER），
            // loader 已内嵌在二进制里，不设这个变量就会自动解到 PROOT_TMP_DIR。
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
            pb.environment().put("PROOT_TMP_DIR", tmpDir(ctx).getAbsolutePath());
            pb.environment().put("PROOT_NO_SECCOMP", "1");
            pb.environment().remove("PROOT_LOADER");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out = drain(p, 12);
            boolean done = p.waitFor(90, java.util.concurrent.TimeUnit.SECONDS);
            int code = done ? p.exitValue() : -1;
            // 这一步也是 proot 的自检：它跑不起来时这里最先露馅
            EngineService.log("SSH 密钥这一步 exit=" + code + (done ? "" : "（超时）"));
            if (code != 0 && !out.isEmpty()) EngineService.log("proot 说: " + out);
            return code == 0;
        } catch (Exception e) {
            EngineService.log("生成 SSH 密钥失败: " + e);
            return false;
        }
    }

    /** 读进程输出（最多 max 行，防止日志爆炸），返回拼成一行的摘要。 */
    static String drain(Process p, int max) {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            int n = 0;
            while ((line = r.readLine()) != null) {
                if (n++ < max) sb.append(line.trim()).append(" | ");
            }
        } catch (IOException ignored) { }
        return sb.toString().trim();
    }

    static Process start(Context ctx, int port) throws IOException {
        File rootfs = new RootfsManager(ctx).rootfsDir();
        File proot = prootBinary(ctx);
        if (!proot.isFile()) throw new IOException("缺少 proot 二进制: " + proot);
        if (!proot.canExecute()) {
            //noinspection ResultOfMethodCallIgnored
            proot.setExecutable(true, false);
        }

        File tmp = tmpDir(ctx);

        List<String> cmd = new ArrayList<>();
        // 用 Android 自带的 /system/bin/env 显式注入环境变量，而不是只靠
        // ProcessBuilder.environment()。
        cmd.add("/system/bin/env");
        cmd.add("PROOT_NO_SECCOMP=1");
        cmd.add("PROOT_TMP_DIR=" + tmp.getAbsolutePath());
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
        // 见 ensureSshKey() 里的说明：设了不存在的 loader 会让所有 execve 变成 ENOENT。
        env.remove("PROOT_LOADER");
        pb.directory(rootfs);
        pb.redirectErrorStream(true);
        return pb.start();
    }
}
