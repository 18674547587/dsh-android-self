package dev.self.dsh;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

/** 前台服务：解压运行时 -> 起 proot -> 保活 -> 收集日志。 */
public class EngineService extends Service {

    static final String TAG = "DshEngine";
    private static final String CHANNEL = "dsh_engine";
    private static final int NOTI_ID = 1001;
    static final int PORT = 3080;
    /** 换 rootfs 内容时改这个串，触发重新解压 */
    static final String RUNTIME_VERSION = "ubuntu24.04-node22.20-dsh0.2.2-rc.1-r1";

    static volatile String state = "未启动";
    static volatile boolean running = false;
    private static final ArrayDeque<String> LOG = new ArrayDeque<>();
    private static final int LOG_MAX = 300;

    private PowerManager.WakeLock wakeLock;
    private Process proc;
    private Thread worker;

    static void log(String s) {
        String line = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()) + "  " + s;
        synchronized (LOG) {
            LOG.addLast(line);
            while (LOG.size() > LOG_MAX) LOG.removeFirst();
        }
        Log.i(TAG, s);
    }

    static String logTail(int n) {
        StringBuilder sb = new StringBuilder();
        synchronized (LOG) {
            int skip = Math.max(0, LOG.size() - n);
            int i = 0;
            for (String s : LOG) {
                if (i++ < skip) continue;
                sb.append(s).append('\n');
            }
        }
        return sb.toString();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL, "DSH 引擎", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void notifyState(String text) {
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setContentTitle("DSH 自建版")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setOngoing(true);
        startForeground(NOTI_ID, b.build());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            shutdown();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) return START_STICKY;

        notifyState("准备中…");
        acquireWake();
        running = true;
        worker = new Thread(this::boot, "dsh-boot");
        worker.start();
        return START_STICKY;
    }

    private void acquireWake() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dsh:engine");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    private void boot() {
        try {
            state = "解压运行时";
            notifyState(state);
            RootfsManager rm = new RootfsManager(this);
            rm.ensure(RUNTIME_VERSION, new RootfsManager.Listener() {
                @Override public void onStage(String stage) {
                    state = stage;
                    notifyState(stage);
                    log(stage);
                }
                @Override public void onBytes(long done) {
                    log("已解压 " + (done >> 20) + " MiB");
                }
            });

            rm.installProot();
            log("proot 已就位");

            ProotLauncher.ensureSshKey(this);
            log("SSH 密钥就绪");

            state = "启动引擎";
            notifyState(state);
            log("proot 启动中…");
            proc = ProotLauncher.start(this, PORT);
            pump(proc);

            // 等端口
            state = "等待 127.0.0.1:" + PORT;
            notifyState(state);
            boolean ok = false;
            for (int i = 0; i < 120; i++) {
                if (portAlive()) { ok = true; break; }
                Thread.sleep(1000);
            }
            if (ok) {
                state = "就绪 http://127.0.0.1:" + PORT;
                log("引擎就绪");
            } else {
                state = "端口未就绪，看日志";
                log("等待超时，进程存活=" + (proc != null && proc.isAlive()));
            }
            notifyState(state);

            int code = proc.waitFor();
            log("引擎退出，code=" + code);
            state = "已退出 (" + code + ")";
            notifyState(state);
        } catch (Exception e) {
            log("启动失败: " + e);
            state = "启动失败: " + e.getMessage();
            notifyState(state);
        } finally {
            running = false;
            releaseWake();
        }
    }

    private void pump(Process p) {
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                File logFile = new File(getFilesDir(), "engine.log");
                FileOutputStream fos = new FileOutputStream(logFile, true);
                while ((line = r.readLine()) != null) {
                    log(line);
                    fos.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                }
                fos.close();
            } catch (IOException ignored) { }
        }, "dsh-log");
        t.setDaemon(true);
        t.start();
    }

    private boolean portAlive() {
        java.net.Socket s = new java.net.Socket();
        try {
            s.connect(new java.net.InetSocketAddress("127.0.0.1", PORT), 400);
            return true;
        } catch (IOException e) {
            return false;
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    private void shutdown() {
        state = "已停止";
        if (proc != null) {
            proc.destroy();
            proc = null;
        }
        running = false;
        releaseWake();
        log("已手动停止");
    }

    private void releaseWake() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }
}
