package dev.self.dsh;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

/** 单 Activity：WebView 装官方 UI，顶部一条自绘状态栏。 */
public class MainActivity extends Activity {

    private static final int REQ_PERM = 10;

    private WebView web;
    private TextView status;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean loaded = false;
    private volatile boolean polling = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        status = new TextView(this);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        status.setTextColor(Color.WHITE);
        status.setBackgroundColor(0xFF1B4DCC);
        status.setPadding(dp(12), dp(8), dp(12), dp(8));
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setText("正在启动…");
        status.setOnClickListener(v -> showLog());
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        askPermissions();
        startEngine();
        pollPort();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private void askPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
            }
        }
    }

    private void startEngine() {
        Intent i = new Intent(this, EngineService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(i);
        } else {
            startService(i);
        }
    }

    private void pollPort() {
        new Thread(() -> {
            while (polling) {
                boolean alive = false;
                Socket sock = new Socket();
                try {
                    sock.connect(new InetSocketAddress("127.0.0.1", EngineService.PORT), 500);
                    alive = true;
                } catch (IOException ignored) {
                } finally {
                    try { sock.close(); } catch (IOException ignored) { }
                }
                final boolean ok = alive;
                ui.post(() -> {
                    status.setText(EngineService.state);
                    if (ok && !loaded) {
                        loaded = true;
                        web.loadUrl("http://127.0.0.1:" + EngineService.PORT + "/");
                    }
                });
                try { Thread.sleep(ok ? 3000 : 1000); } catch (InterruptedException e) { return; }
            }
        }, "port-poll").start();
    }

    private void showLog() {
        new AlertDialog.Builder(this)
                .setTitle("引擎状态")
                .setMessage(EngineService.state + "\n\n" + EngineService.logTail(40))
                .setPositiveButton("关闭", null)
                .setNeutralButton("重启引擎", (d, w) -> {
                    Intent stop = new Intent(this, EngineService.class).setAction("stop");
                    startService(stop);
                    loaded = false;
                    ui.postDelayed(this::startEngine, 1200);
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        polling = false;
        super.onDestroy();
    }
}
