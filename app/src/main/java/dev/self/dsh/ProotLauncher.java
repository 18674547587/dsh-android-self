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
        env.put("PROOT_NO_SECCOMP", "1");   // 部分 Android 内核 seccomp 下必须
        env.put("PROOT_LOADER", new File(ctx.getFilesDir(), "proot/loader").getAbsolutePath());
        pb.directory(rootfs);
        pb.redirectErrorStream(true);
        return pb.start();
    }
}
