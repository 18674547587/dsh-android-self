package dev.self.dsh;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** 负责把 assets/rootfs.tar.gz 铺到私有目录，并按版本号做幂等。 */
final class RootfsManager {

    interface Listener {
        void onStage(String stage);
        void onBytes(long done);
    }

    private final Context ctx;

    RootfsManager(Context ctx) { this.ctx = ctx; }

    File rootfsDir() { return new File(ctx.getFilesDir(), "rootfs"); }

    private File stampFile() { return new File(ctx.getFilesDir(), "rootfs.stamp"); }

    boolean isReady(String version) {
        File f = stampFile();
        if (!f.exists()) return false;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[128];
            int n = in.read(b);
            if (n <= 0) return false;
            return new String(b, 0, n, StandardCharsets.UTF_8).trim().equals(version);
        } catch (IOException e) {
            return false;
        }
    }

    /** 幂等铺开。已就绪则立即返回。 */
    void ensure(String version, Listener l) throws IOException {
        if (isReady(version)) {
            if (l != null) l.onStage("运行时已就绪");
            return;
        }
        File dir = rootfsDir();
        if (l != null) l.onStage("清理旧运行时");
        deleteRecursively(dir);
        if (!dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("无法创建 rootfs 目录: " + dir);
        }

        if (l != null) l.onStage("解压 Ubuntu 运行时（首次约 3~8 分钟）");
        AssetManager am = ctx.getAssets();
        try (InputStream in = am.open("rootfs.bin", AssetManager.ACCESS_STREAMING)) {
            TarGz.extract(in, dir, done -> {
                if (l != null) l.onBytes(done);
            });
        }

        // 写版本戳
        try (FileOutputStream out = new FileOutputStream(stampFile())) {
            out.write(version.getBytes(StandardCharsets.UTF_8));
        }

        if (l != null) l.onStage("运行时解压完成");
    }


    /** 把 assets/proot/{proot,loader} 铺到私有目录并置可执行位。 */
    void installProot() throws IOException {
        File dir = new File(ctx.getFilesDir(), "proot");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("无法创建目录: " + dir);
        }
        copyAsset("proot/proot", new File(dir, "proot"), true);
        try {
            copyAsset("proot/loader", new File(dir, "loader"), true);
        } catch (IOException ignored) {
            // 静态版 proot 可能不需要独立 loader
        }
    }

    private void copyAsset(String name, File dst, boolean exec) throws IOException {
        try (InputStream in = ctx.getAssets().open(name);
             FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        if (exec) {
            //noinspection ResultOfMethodCallIgnored
            dst.setExecutable(true, false);
        }
    }

    static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursively(k);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
