/*
 * 壳层移动端适配引导：给 dsh-mobile-adapt 的 client.js 造一个假的模块加载器与 ctx，
 * 让它在 WebView 里独立跑起来，不依赖 dsh 的插件系统（0.2.2 上 /plugins/<id>/client.js 实测 404）。
 *
 * 注入顺序：本文件 -> dshm-client.js -> 延迟等 DOM -> apply(ctx)
 */
(function () {
    if (window.__dshmBooted) return;
    window.__dshmBooted = 1;

    var pending = [];
    var realLoader = window.__ModuleLoader__;

    window.__ModuleLoader__ = {
        load: function (mod) {
            try {
                if (typeof mod.factory === 'function') {
                    pending.push(mod.factory(function () { return {}; }));
                }
            } catch (e) {
                console.error('[dshm] factory failed', e);
            }
        }
    };

    function clickSidebar() {
        var btns = document.querySelectorAll('button[aria-label],button[title]');
        for (var i = 0; i < btns.length; i++) {
            var l = (btns[i].getAttribute('aria-label') || btns[i].getAttribute('title') || '').toLowerCase();
            if (l.indexOf('sidebar') >= 0 || l.indexOf('导航') >= 0 || l.indexOf('侧栏') >= 0) {
                btns[i].click();
                return;
            }
        }
        var f = document.querySelector('[data-sidebar-collapsed]');
        if (f) f.removeAttribute('data-sidebar-collapsed');
    }

    var ctx = {
        effect: function (fn) { try { fn(); } catch (e) { console.error('[dshm] effect failed', e); } },
        layout: {
            toggleSidebar: clickSidebar,
            openDetails: function () { document.documentElement.setAttribute('data-dshm-details', '1'); }
        }
    };

    var tries = 0;
    function run() {
        // 等 dsh 的 React 把框架渲染出来（窄屏时主框架一定在）
        var ready = document.querySelector('[data-slot="sidebar"],[data-sidebar-collapsed],[data-details-collapsed]');
        if (!ready && tries++ < 40) { setTimeout(run, 500); return; }

        // 如果 dsh 自己已经加载了插件（style 已注入），不重复跑
        if (document.querySelector('style[data-plugin="dsh-mobile-adapt"]')) {
            console.log('[dshm] plugin already active, skip');
            return;
        }
        if (!pending.length) { console.warn('[dshm] client factory 未注册'); return; }
        pending.forEach(function (exp) {
            try {
                if (exp && typeof exp.apply === 'function') exp.apply(ctx);
            } catch (e) {
                console.error('[dshm] apply failed', e);
            }
        });
        console.log('[dshm] mobile adapt applied');
    }
    setTimeout(run, 600);

    // 恢复真正的加载器（页面自己的 bundle 可能还需要它）
    if (realLoader) setTimeout(function () { window.__ModuleLoader__ = realLoader; }, 3000);
})();
