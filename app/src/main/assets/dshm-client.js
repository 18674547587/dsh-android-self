/**
 * dsh-mobile-adapt —— 浏览器半侧。
 *
 * DSH 的 Web UI 是三栏 grid（侧栏轨道 | 对话 | 详情栏），列宽由 AppFrame 以
 * 内联 `grid-template-columns` 写在 DOM 上，因此移动端适配无法只靠一张静态
 * 样式表完成。本插件在浏览器里做三件事：
 *
 *   1. 注入移动端样式表（`<style data-plugin>`，与官方 ui-theme 同机制）；
 *   2. 给 `<html>` 打状态标记（`data-dshm`、`data-dshm-drawer`、
 *      `data-dshm-details`），把 React 拥有的状态投影成可被 CSS 选择的信号；
 *   3. 挂载遮罩与边缘把手，补齐触摸端缺失的交互。
 *
 * 选择器一律走**结构与 data 槽位**（`[data-slot="sidebar"]` 等），不依赖
 * CSS Modules 的哈希类名，因此对上游构建产物变化更宽容。
 *
 * 插件包格式为 DSH 的惰性 CJS 工厂（`window.__ModuleLoader__.load`）：
 * 脚本执行时只注册 factory，样式注入等副作用在模块物化时才运行。
 */
window.__ModuleLoader__.load({
	id: "dsh-mobile-adapt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** 插件标识：用于 `<style data-plugin>` 与 effect 命名。 */
		const PLUGIN_ID = "dsh-mobile-adapt";
		/**
		 * 移动端断点（px）。取 DSH 自己的窄屏阈值（SIDEBAR_AUTO_COLLAPSE = 1024），
		 * 而不是更窄的 768：上游在 viewport < 1024 时就已经按窄屏处理（侧栏自动折叠），
		 * 插件必须跟着上游的判断走，否则会出现「上游已折叠、插件没接管」的空档。
		 */
		const BREAKPOINT = 1024;

		/** URL 强制开关：?dshm=on 强制启用，?dshm=off 强制禁用（排查用）。 */
		const FORCE_MODE = (() => {
			try {
				return new URLSearchParams(window.location.search).get('dshm');
			} catch (error) {
				return null;
			}
		})();

		const CSS = `
/* ══════════════════════════════════════════════════════════════════════
   dsh-mobile-adapt —— DSH Web UI 移动端适配
   仅在 html[data-dshm="on"] 下生效（由 client.js 按视口宽度切换）
   ══════════════════════════════════════════════════════════════════════ */

/* ── 动态视口高度：移动浏览器地址栏收起/展开不再引起布局跳动 ── */
html[data-dshm="on"],
html[data-dshm="on"] body {
  height: 100vh !important;
  height: 100dvh !important;
  max-height: 100vh !important;
  max-height: 100dvh !important;
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}

/* ── 主框架：从三栏网格收敛为单列 ──
   这里不能用「grid-template-columns: 0 1fr 0」：侧栏改成 position:fixed
   后会脱离网格流，自动放置算法会把中间栏塞进第一列（0px 宽）而塌陷。
   改用 block，让中间栏自然占满框架。

   早期版本这里写过 'width: 1000px !important'，想骗过 AppFrame 的视口测量
   （它用 ResizeObserver 量 frame 宽度当 viewport），好让 computeColumns
   算得出详情栏的宽度。已移除，原因见下方详情栏那段的说明。 */
html[data-dshm="on"] [data-slot="root"] > div {
  display: block !important;
  width: 100% !important;
  overflow: hidden;
}

/* ── 0.2.0 兼容补丁：frame 改 block 后中间列失去 grid 拉伸，
   高度会塌陷（实测 399px），composer 被顶到页面中部且下半截被切掉
   （卡片 bottom 超出视口 61px）。显式恢复视口高度即可。
   类名是 CSS Modules 哈希（形如 pI_x6G_centerCol），用子串匹配，
   与 _modes / _trailing 同一策略。 ── */
html[data-dshm="on"] [class*="_centerCol"] {
  height: 100dvh !important;
}

/* 中间栏：视觉宽度跟随真实屏幕，而不是被抬高的测量宽度 */
html[data-dshm="on"] [data-dshm-col="conversation"] {
  width: 100vw;
  height: 100%;
}

/* ── 列拖动手柄在触摸端无意义，且会盖住内容 ── */
html[data-dshm="on"] [data-slot="root"] > div > div[style^="left:"] {
  display: none !important;
}

/* ══ 侧栏 → 抽屉 ══════════════════════════════════════════════════════ */
/* ⚠ 这里用 left 位移，**绝不能用 transform**。
   侧栏内部挂着 DSH 自己的浮层：设置面板走 'sidebar.settings' slot，
   DOM 上位于侧栏底部（SidebarRoot.tsx 的 foot 区），本身是
   'position: fixed'。而 transform / will-change: transform 会把侧栏
   变成所有 fixed 后代的**包含块**，于是设置面板被锁进侧栏的宽度里
   并跟着侧栏一起移出屏幕（实测 x = -323，整块面板不可见）。
   代价是 left 过渡走布局而不是合成层，280ms 的抽屉动画肉眼无差别。 */
html[data-dshm="on"] [data-dshm-col="sidebar"] {
  position: fixed !important;
  top: 0;
  left: min(-86vw, -320px);
  bottom: 0;
  width: min(86vw, 320px) !important;
  max-width: 320px;
  height: 100vh;
  height: 100dvh;
  z-index: 80;
  transition: left 280ms cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: 0 12px 48px rgb(0 0 0 / 32%);
  border-right: none !important;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  overscroll-behavior: contain;
}

/* 抽屉展开：AppFrame 移除了 data-sidebar-collapsed */
html[data-dshm="on"][data-dshm-drawer="1"] [data-dshm-col="sidebar"] {
  left: 0;
}

/* 触摸端把导航按钮放大到可点尺寸 */
html[data-dshm="on"] [data-slot="sidebar"] button,
html[data-dshm="on"] [data-slot="sidebar"] [role="button"] {
  min-height: 44px;
}

/* ══ 详情栏 → 全屏浮层 ════════════════════════════════════════════════
   rc.7 的详情栏是网格里的第三列（renderSlot("details")），宽度由
   AppFrame 的 computeColumns 算：

     const s = sidebar === 0 ? 56 : clamp(sidebar, 264, 420)
     const d0 = details === 0 ? 0 : clamp(details, 300, 520)
     if (s + d0 + 640 <= viewport) return { s, viewport - s - d0, d0 }
     const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640)
     if (s + d1 + 640 <= viewport) return { s, 640, d1 }
     return { s, viewport - s, 0 }        // ← 390px 屏永远走到这里

   viewport 由 AppFrame 用 ResizeObserver 量 frame 宽度得到（≈真实屏宽），
   openDetails() 只是把 details 置 360，救不了：56 + 300 + 640 = 996 > 390，
   第三列恒为 0。也就是说窄屏下上游这条链路**在数学上就不可能成立**。

   所以这里不跟网格较劲：把第三列摘出来做 fixed 全屏浮层，开合由插件
   自己维护的 html[data-dshm-details] 驱动（不再依赖上游的
   data-details-collapsed）。能这么做的前提是 AppFrame 自己写的注释：
   "details 0 means visually closed (never unmounted)" —— 第三列的
   occupant 一直在 DOM 里，只是宽 0，所以我们拿到的是有内容的面板。 */
html[data-dshm="on"] [data-dshm-col="details"] {
  position: fixed !important;
  top: 0;
  left: 100vw;
  bottom: 0;
  width: 100vw !important;
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  z-index: 78;
  background: var(--dsw-alias-bg-base, #fff);
  transition: left 280ms cubic-bezier(0.32, 0.72, 0, 1);
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

/* 详情栏打开：由插件维护的标记驱动（不再依赖上游 data-details-collapsed） */
html[data-dshm="on"][data-dshm-details="1"] [data-dshm-col="details"] {
  left: 0;
}

/* ══ 遮罩 ═════════════════════════════════════════════════════════════ */
.dshm-scrim {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 79;
  background: rgb(0 0 0 / 42%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 280ms ease;
  -webkit-tap-highlight-color: transparent;
}
html[data-dshm="on"][data-dshm-drawer="1"] .dshm-scrim {
  opacity: 1;
  pointer-events: auto;
}

/* ══ 边缘把手 ═════════════════════════════════════════════════════════
   入口贴在屏幕左边缘、垂直居中。为什么不放左上角：那里是会话头部的
   地盘，放那儿就必须用 padding 把标题推开（一个魔数），而头部内部结构
   一变就失效。移到垂直中段后，把手（y ≈ 50%）与头部（y ≈ 0–56）在
   垂直方向天然不重叠，头部因此完全保持原生样式，无需任何让位。 */
.dshm-fab {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 76;
  width: 12px;
  height: 52px;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 0 10px 10px 0;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  color: var(--dsw-alias-label-primary, #0f1115);
  box-shadow: 0 2px 14px rgb(0 0 0 / 16%), 0 0 0 0.5px rgb(0 0 0 / 6%);
  cursor: pointer;
  opacity: 0.8;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 160ms ease, transform 160ms ease;
}

/* 触摸热区：视觉只有 12px 宽，手指点不中，故把可点区域扩到 32×84。
   热区只向右侵入 32px（落在消息流左侧留白内），向左不出屏。 */
.dshm-fab::after {
  content: "";
  position: absolute;
  top: -16px;
  bottom: -16px;
  left: 0;
  width: 32px;
}

html[data-dshm="on"] .dshm-fab {
  display: flex;
}
.dshm-fab:active {
  opacity: 1;
  transform: translateY(-50%) scale(0.96);
}

/* 抽屉打开时收起把手，避免与抽屉内容重叠 */
html[data-dshm="on"][data-dshm-drawer="1"] .dshm-fab {
  display: none;
}

/* ══ 详情栏入口：右边缘把手（与左侧导航把手镜像对称） ══════════════
   rc.7 上游没有把「打开详情栏」接到任何 UI 元素上（证据见 README 的
   「上游 rc.7 这条链路是断的」），所以这里补一个入口。
   详情栏自带 'Close details' 按钮，不会把用户困在全屏浮层里。 */
.dshm-details-fab {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 76;
  width: 12px;
  height: 52px;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 10px 0 0 10px;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  color: var(--dsw-alias-label-primary, #0f1115);
  box-shadow: 0 2px 14px rgb(0 0 0 / 16%), 0 0 0 0.5px rgb(0 0 0 / 6%);
  cursor: pointer;
  opacity: 0.8;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 160ms ease, transform 160ms ease;
}

/* 触摸热区：同左侧把手，向右不出屏、向左侵入 32px。 */
.dshm-details-fab::after {
  content: "";
  position: absolute;
  top: -16px;
  bottom: -16px;
  right: 0;
  width: 32px;
}

html[data-dshm="on"] .dshm-details-fab {
  display: flex;
}
.dshm-details-fab:active {
  opacity: 1;
  transform: translateY(-50%) scale(0.96);
}

/* 抽屉或详情栏打开时收起，避免叠加在浮层之上 */
html[data-dshm="on"][data-dshm-drawer="1"] .dshm-details-fab,
html[data-dshm="on"][data-dshm-details="1"] .dshm-details-fab {
  display: none;
}

/* ══ 设置面板 → 整屏 + 顶部横向 tab ═══════════════════════════════════
   设置面板走 'sidebar.settings' slot，DOM 挂在侧栏底部，本身是 fixed 浮层
   （上游 .overlay: fixed/inset 0/z-index 1000，.panel: 800×800、
   max-width: calc(100vw - 48px)，.nav: 固定 188px 竖列）。
   390px 屏上算下来内容列只剩 154px，表单会被挤成一团；更糟的是此前
   侧栏的 transform 把它整体困在侧栏宽度里（见上面侧栏那段的说明）。
   移动端直接整屏铺开，并把左侧竖列改成顶部横向滚动 tab。
   标记由 client.js 的 markOverlays() 打上（不用 :has()，理由同三列标记）。 */
html[data-dshm="on"] [data-dshm-overlay="settings"] {
  align-items: stretch !important;
  justify-content: flex-start !important;
}

html[data-dshm="on"] [data-dshm-panel="settings"] {
  flex-direction: column !important;
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  max-height: 100dvh !important;
  border-radius: 0 !important;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}

/* 导航：188px 竖列 → 顶部横向滚动 tab 条 */
html[data-dshm="on"] [data-dshm-nav] {
  flex: none !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  padding: 10px 12px !important;
  box-sizing: border-box;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 8%));
}

/* 标题（"设置"）在 tab 条左端做锚点，不再占一整列 */
html[data-dshm="on"] [data-dshm-nav] > *:first-child {
  flex: none !important;
  padding: 0 !important;
  white-space: nowrap;
}

html[data-dshm="on"] [data-dshm-navlist] {
  flex: 1 1 auto !important;
  min-width: 0;
  flex-direction: row !important;
  gap: 6px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-bottom: 0 !important;
}
html[data-dshm="on"] [data-dshm-navlist]::-webkit-scrollbar {
  display: none;
}

/* 每个 tab 由内容决定宽度，不换行、不压缩 */
html[data-dshm="on"] [data-dshm-navcell] {
  flex: none !important;
  width: auto !important;
  min-height: 40px;
  box-sizing: border-box;
  white-space: nowrap;
  padding: 8px 14px !important;
}
html[data-dshm="on"] [data-dshm-navcell] > *:last-child,
html[data-dshm="on"] [data-dshm-nav] [class*="navLabel"] {
  width: auto !important;
  min-width: 0 !important;
  white-space: nowrap;
}

/* 内容列：吃掉除 tab 条以外的全部高度与宽度。
   min-height: 0 是关键：上游 .content 只有 flex: 1 和 min-width: 0，
   在横向布局下够用，但换成纵向布局后 min-height: auto 会让它按内容
   高度撑开（实测 842px > 可用 779px），底部表单被 .panel 的
   overflow: hidden 裁掉且滚不动。置 0 后上游自己的
   .options { overflow-y: auto } 才能接管滚动。 */
html[data-dshm="on"] [data-dshm-panel="settings"] > *:last-child {
  flex: 1 1 0 !important;
  min-width: 0;
  min-height: 0 !important;
  width: 100% !important;
}

/* ══ Hero 标题行：与输入框共用同一条左边线 ══════════════════════════
   DSH 的 hero 标题行（logo + 标题 + 预览徽章）是 display: grid 且
   justify-content: center。在桌面或窄内容区里它看着像左对齐，但内容区
   拉满整屏后，居中的标题会明显右移（实测 logo 左边缘 68px，而输入框
   内边距是 24px），跟满宽的输入框对不上边。移动端改成左对齐。
   类名用 [class*="_headline"] 并排除 headlineText：CSS Modules 的前缀
   会随构建变，但语义名不变。 */
html[data-dshm="on"] [class*="_headline"]:not([class*="headlineText"]) {
  justify-content: start !important;
}

/* ══ 提问卡片（ui-user-questions）═════════════════════════════════════
   上游自带 @media (max-width: 720px) 断点（圆角、内边距、标题字号），
   卡片本身 width: 100% + max-width: var(--dsh-chat-content-width)，窄屏
   会自动收缩。实测 390px：卡片满宽、选项行 42px、无横向溢出 —— 所以
   这里不重做布局，只补两件上游在触摸端没做的事：
     1) 选项行触摸高度统一到 44px（上游 min-height 是 40px）；
     2) 卡片底部让出手势条安全区。
   选择器走 [data-question-key]：ui-user-questions 自己写在卡片根节点上的
   稳定属性，不受 CSS Modules 哈希影响。 */
html[data-dshm="on"] [data-question-key] [class*="_options"] > *,
html[data-dshm="on"] [data-question-key] [class*="_customRow"] {
  min-height: 44px;
}

html[data-dshm="on"] [data-question-key] {
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}

/* ══ 输入区：底部安全区（手势条 / 虚拟键盘） ══════════════════════════ */
html[data-dshm="on"] [data-composer-seat] {
  padding-bottom: env(safe-area-inset-bottom);
}

/* 工具行：窄屏下权限按钮会压到模型按钮身上。
   DSH 给 _modes 写了 min-width: 0（InputBar.module.css 的 .modes），卡片一行放不下时
   它被 flex 压到 11px，可里面的权限按钮不跟着缩，于是溢出、直接盖住右边的模型按钮
   —— 上游注释里 external:107 指的就是这处，只是它指望的换行没被激活。
   这里让它不参与收缩；窄屏再收起「推理等级」标签（菜单里本来就看得到），把宽度还给模型名。 */
html[data-dshm="on"] [data-composer-card] [class*="_modes"] {
  flex: none !important;
  min-width: auto !important;
}
@media (max-width: 420px) {
  html[data-dshm="on"] [data-composer-card] [class*="_trailing"] [class*="_triggerEffort"] {
    display: none !important;
  }
  html[data-dshm="on"] [data-composer-card] [class*="_trailing"] [class*="_trigger"] {
    max-width: 160px !important;
  }
}

/* 触摸端输入控件字号不低于 16px，避免 iOS 聚焦时自动放大页面 */
html[data-dshm="on"] textarea,
html[data-dshm="on"] [contenteditable="true"] {
  font-size: max(16px, 1em);
}
`;

		/** 边缘把手上的图标：竖排三点，比汉堡图标更贴合 12px 宽的窄条。 */
		const FAB_ICON =
			'<svg width="4" height="18" viewBox="0 0 4 18" fill="currentColor" aria-hidden="true">'
			+ '<circle cx="2" cy="2" r="1.6"/><circle cx="2" cy="9" r="1.6"/><circle cx="2" cy="16" r="1.6"/></svg>';

		/** 详情栏把手上的图标：右向箭头，暗示面板从右侧滑入。 */
		const DETAILS_ICON =
			'<svg width="6" height="12" viewBox="0 0 6 12" fill="none" stroke="currentColor" '
			+ 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
			+ '<path d="M1.2 1.2 4.8 6l-3.6 4.8"/></svg>';

		/** React 挂在 DOM 节点上的内部属性前缀（后缀随构建变化）。 */
		const FIBER_KEYS = ['__reactFiber$', '__reactInternalInstance$'];

		/** 取 DOM 节点上的 React fiber 入口。 */
		function fiberOf(node) {
			const key = Object.keys(node).find(k => FIBER_KEYS.some(prefix => k.startsWith(prefix)));
			return key === undefined ? null : node[key];
		}

		/**
		 * 沿 React fiber 向上查找上游注入的 `openDetails`。
		 *
		 * 为什么非这样不可：rc.7 里 `openDetails` 只存在于 `conversation.view`
		 * slot 的 inject props 中（ui-conversation 的 slots.register），
		 * 既不是 ctx 服务也没有导出；而工具行组件 ToolCallTree 的 props 里
		 * 只有只读的 `selectedCallId`。要让"点工具行 → 看详情"跑通，
		 * 只能顺着 React 树把它找出来。找不到就退化为只打开面板。
		 * @param node - 消息流里被点击的元素。
		 * @returns 含 openDetails 的 props 对象，或 null。
		 */
		function findInjectedProps(node) {
			let fiber = fiberOf(node);
			for (let depth = 0; fiber != null && depth < 80; depth += 1) {
				const props = fiber.memoizedProps;
				if (props !== null && typeof props === 'object' && typeof props.openDetails === 'function') return props;
				fiber = fiber.return;
			}
			return null;
		}

		/**
		 * 从被点击的工具行取 callId —— 详情栏靠它定位显示哪个工具。
		 * selection 的形状由 ui-conversation 决定：`s.selection?.callId`。
		 * @param node - 消息流里被点击的元素。
		 * @returns callId 字符串，或 null。
		 */
		function findCallId(node) {
			let fiber = fiberOf(node);
			for (let depth = 0; fiber != null && depth < 80; depth += 1) {
				const props = fiber.memoizedProps;
				if (props !== null && typeof props === 'object') {
					if (typeof props.callId === 'string') return props.callId;
					const data = props.node !== undefined && props.node !== null ? props.node.data : undefined;
					const root = data !== undefined && data !== null ? data.root : undefined;
					if (root !== undefined && root !== null && typeof root.callId === 'string') return root.callId;
				}
				fiber = fiber.return;
			}
			return null;
		}

		/**
		 * 当前视口是否属于移动端。
		 * 支持 ?dshm=on / ?dshm=off 强制覆盖，用来快速判断"到底是没生效还是没加载"。
		 */
		function isMobileViewport() {
			if (FORCE_MODE === 'on') return true;
			if (FORCE_MODE === 'off') return false;
			return window.matchMedia('(max-width: ' + BREAKPOINT + 'px)').matches;
		}

		/**
		 * 挂载移动端样式表，插件卸载时随 effect 一起移除。
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function installStyles(ctx) {
			if (typeof document === 'undefined') return;
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.dataset.plugin = PLUGIN_ID;
				tag.dataset.pluginCss = PLUGIN_ID + '/mobile.css';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => { tag.remove(); };
			}, PLUGIN_ID + ': mobile stylesheet');
		}

		/**
		 * 把 React 拥有的布局状态投影成 `<html>` 上的标记，并挂载触摸端交互。
		 *
		 * 状态来源（均由 AppFrame 写在主框架元素上，见 ui-layout/AppFrame.tsx）：
		 *   - 无 `data-sidebar-collapsed` → 侧栏处于展开态 → 抽屉滑出
		 *   - 无 `data-details-collapsed` → 详情栏打开 → 全屏浮层滑入
		 *
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function mountTouchShell(ctx) {
			if (typeof document === 'undefined') return;
			ctx.effect(() => {
				const html = document.documentElement;
				const frameOf = () => document.querySelector('[data-slot="root"] > div');
				/**
				 * 侧栏开关不再借道 DOM 按钮。
				 *
				 * 早期版本按 aria-label 在 `[data-slot="sidebar"] button` 里找
				 * `Open sidebar` / `Collapse sidebar` 再 .click()，既怕文案改动
				 * （中英文、措辞），也怕取错按钮（展开态首位是 `New session`）。
				 * ctx.layout.toggleSidebar() 是官方契约
				 * （ui-layout/src/client/service.ts），窄屏下它只翻转
				 * narrowExpanded（stores.ts），正是抽屉需要的语义。
				 */

				let scrim = null;
				let fab = null;
				let detailsFab = null;
				let bodyObserver = null;
				let frameObserver = null;
				let watchedFrame = null;
				let media = null;

				/** 同步抽屉开合标记（详情浮层由插件自己控制，见 setDetailsOpen）。 */
				const syncPanels = () => {
					const frame = frameOf();
					if (frame === null) return;
					html.setAttribute('data-dshm-drawer', frame.hasAttribute('data-sidebar-collapsed') ? '0' : '1');
				};

				/**
				 * 详情浮层的开合（插件自己的状态）。
				 *
				 * 为什么不跟上游的 data-details-collapsed 走：窄屏下
				 * computeColumns 恒返回 details = 0（推导见样式表里详情栏那段），
				 * 那个属性永远是 true，跟着它走就永远打不开。而 occupant 从不卸载，
				 * 所以自己维护一个标记即可。
				 * @param open - 是否展开详情浮层。
				 */
				const setDetailsOpen = (open) => {
					if (open) {
						html.setAttribute('data-dshm-details', '1');
						closeDrawer();
					} else {
						html.removeAttribute('data-dshm-details');
					}
				};

				/**
				 * 给三列容器打上 `data-dshm-col` 标记。
				 *
				 * 为什么不直接在 CSS 里用 `:has()`：`:has()` 要到 Chrome 105 才默认启用，
				 * 部分国产手机浏览器内核还不支持，那样整套适配会**静默失效**
				 * （不报错、也不出样式，看起来就是"完全没做适配"）。
				 * 改由 JS 打标记后，CSS 只需要普通属性选择器，兼容性风险归零。
				 */
				const markColumns = () => {
					const frame = frameOf();
					if (frame === null) return;
					const children = frame.children;
					for (let i = 0; i < children.length; i += 1) {
						const child = children[i];
						let mark = null;
						const subs = child.children;
						for (let j = 0; j < subs.length; j += 1) {
							const slot = subs[j].getAttribute('data-slot');
							if (slot === 'sidebar' || slot === 'details' || slot === 'conversation') { mark = slot; break; }
						}
						if (mark !== null) child.setAttribute('data-dshm-col', mark);
					}
				};

				/**
				 * 给设置面板打 `data-dshm-overlay` / `data-dshm-panel` /
				 * `data-dshm-nav` / `data-dshm-navlist` / `data-dshm-navcell` 标记。
				 *
				 * 为什么需要：设置面板是 `sidebar.settings` slot 的产物，DOM 上
				 * 挂在侧栏底部的 foot 区里，类名是 CSS Modules 的哈希前缀
				 * （VOzbGW_overlay 之类，前缀随构建变），而 slot 名和结构位置稳定。
				 * 面板内部结构固定为「overlay > 遮罩 + 面板」「面板 > 导航 + 内容」
				 * 「导航 > 标题 + 列表」（ui-settings-general/SettingsRoot.tsx）。
				 * 拿不准就什么都不打，样式自然不生效，不会把界面搞坏。
				 */
				const markOverlays = () => {
					const hosts = document.querySelectorAll('[data-slot="sidebar.settings"]');
					for (let i = 0; i < hosts.length; i += 1) {
						const kids = hosts[i].children;
						for (let j = 0; j < kids.length; j += 1) {
							const node = kids[j];
							// 这个 slot 的子元素有两个：设置入口按钮（trigger，静态定位）
							// 和面板浮层（overlay，fixed）。只有后者该被标记。
							if (node.tagName !== 'DIV' || getComputedStyle(node).position !== 'fixed') {
								// 早期版本误标过入口按钮，顺手清掉，避免样式串到按钮上。
								if (node.hasAttribute('data-dshm-overlay')) node.removeAttribute('data-dshm-overlay');
								if (node.hasAttribute('data-dshm-panel')) node.removeAttribute('data-dshm-panel');
								continue;
							}
							const overlay = node;
							if (overlay.getAttribute('data-dshm-overlay') !== 'settings') {
								// 面板 = overlay 的子元素里唯一非绝对定位的那个（另一个是遮罩）。
								let panel = null;
								for (let k = 0; k < overlay.children.length; k += 1) {
									const child = overlay.children[k];
									if (getComputedStyle(child).position !== 'absolute') { panel = child; break; }
								}
								if (panel === null) continue;
								overlay.setAttribute('data-dshm-overlay', 'settings');
								panel.setAttribute('data-dshm-panel', 'settings');
								const nav = panel.children[0];
								if (nav === undefined || nav === null) continue;
								nav.setAttribute('data-dshm-nav', '');
								const list = nav.children[1];
								if (list === undefined || list === null) continue;
								list.setAttribute('data-dshm-navlist', '');
								for (let m = 0; m < list.children.length; m += 1) {
									list.children[m].setAttribute('data-dshm-navcell', '');
								}
								continue;
							}
							// 已标记过：切换分区时上游会重建 tab，补标新增的那些即可。
							const list = overlay.querySelector('[data-dshm-navlist]');
							if (list === null) continue;
							for (let m = 0; m < list.children.length; m += 1) {
								const cell = list.children[m];
								if (cell.getAttribute('data-dshm-navcell') === null) cell.setAttribute('data-dshm-navcell', '');
							}
						}
					}
				};

				/** 按视口宽度切换整体开关。 */
				const syncMode = () => {
					if (isMobileViewport()) html.setAttribute('data-dshm', 'on');
					else html.removeAttribute('data-dshm');
					syncPanels();
				};

				/** 关闭抽屉：直接调 layout.toggleSidebar()，不再借道 DOM 按钮。 */
				const closeDrawer = () => {
					const frame = frameOf();
					if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return;
					ctx.layout.toggleSidebar();
				};

				/** 懒挂载遮罩与浮动按钮（React 首次渲染后才需要）。 */
				const ensureChrome = () => {
					if (scrim === null) {
						scrim = document.createElement('div');
						scrim.className = 'dshm-scrim';
						scrim.setAttribute('data-dshm-scrim', '');
						scrim.addEventListener('click', closeDrawer);
						document.body.appendChild(scrim);
					}
					if (fab === null) {
						fab = document.createElement('button');
						fab.type = 'button';
						fab.className = 'dshm-fab';
						fab.setAttribute('aria-label', '打开导航');
						fab.innerHTML = FAB_ICON;
						fab.addEventListener('click', () => { ctx.layout.toggleSidebar(); });
						document.body.appendChild(fab);
					}
					if (detailsFab === null) {
						detailsFab = document.createElement('button');
						detailsFab.type = 'button';
						detailsFab.className = 'dshm-details-fab';
						detailsFab.setAttribute('aria-label', '打开详情');
						detailsFab.innerHTML = DETAILS_ICON;
						// 只翻转插件自己的标记：上游 openDetails() 在窄屏下算不出列宽
						// （56 + 300 + 640 > 屏宽），调了也是空转。
						detailsFab.addEventListener('click', () => {
							setDetailsOpen(html.getAttribute('data-dshm-details') !== '1');
						});
						document.body.appendChild(detailsFab);
					}
				};

				/** 跟踪主框架元素（可能在插件挂载后才出现），并订阅其属性变化。 */
				const watchFrame = () => {
					const frame = frameOf();
					if (frame === null || frame === watchedFrame) return;
					if (frameObserver !== null) frameObserver.disconnect();
					watchedFrame = frame;
					frameObserver = new MutationObserver(syncPanels);
					frameObserver.observe(frame, {
						attributes: true,
						attributeFilter: ['data-sidebar-collapsed', 'data-details-collapsed'],
					});
					syncPanels();
					markColumns();
					markOverlays();
				};

				/**
				 * 侧栏内的导航点击（会话行、新建会话等）之后收起抽屉。
				 *
				 * 开关自身与「操作类」按钮不收起：动作菜单、搜索、添加工作区、
				 * 查看选项、展开更多——这些是就地展开的面板，收起抽屉会把用户
				 * 刚打开的东西一起关掉。会话/工作区行是 `role="treeitem"`。
				 */
				const onDocumentClick = (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					// 浮层的 DOM 也挂在侧栏里：设置面板走 sidebar.settings slot，
					// 位于侧栏的 foot 区（SidebarRoot.tsx 的 renderSlot 调用）。
					// 所以在浮层内的任何点击都必须直接放行 —— 收起抽屉会让 DSH
					// 连带卸载整个设置面板，表现就是"点一下面板就缩回去"。
					if (target.closest('[data-slot="sidebar.settings"]') !== null) return;
					if (target.closest('[data-dshm-col="details"]') !== null) return;
					if (target.closest('[data-slot="sidebar"]') === null) return;
					const button = target.closest('button');
					if (button !== null) {
						const label = (button.getAttribute('aria-label') || '') + ' ' + (button.getAttribute('title') || '');
						if (/sidebar|侧边栏|侧栏|actions|操作|search|搜索|add |添加|view options|more|更多|settings|设置|preferences|偏好/i.test(label)) return;
						window.setTimeout(closeDrawer, 160);
						return;
					}
					if (target.closest('[role="treeitem"]') !== null) window.setTimeout(closeDrawer, 160);
				};
				document.addEventListener('click', onDocumentClick, true);

				/**
				 * 补上「点工具行看详情」这条上游断掉的链路。
				 *
				 * rc.7 里 ToolCallTree 只拿到只读的 selectedCallId，没有任何组件
				 * 调用 openDetails —— 所以桌面上点工具行同样没反应（见 README）。
				 * 这里用事件委托接管：取到 callId 后调用上游自己的
				 * openDetails(target)，它内部会 select(target) + layout.openDetails()。
				 * 不动事件本身（不 preventDefault / stopPropagation），避免干扰
				 * 工具行内的复制、展开等原生交互。
				 */
				const onDetailsClick = (event) => {
					if (!isMobileViewport()) return;
					const target = event.target;
					if (!(target instanceof Element)) return;
					// 详情浮层内部的点击：只接管它自己的关闭按钮，其余交给面板。
					if (target.closest('[data-dshm-col="details"]') !== null) {
						const button = target.closest('button');
						if (button === null) return;
						const label = (button.getAttribute('aria-label') || '') + ' '
							+ (button.getAttribute('title') || '') + ' ' + (button.textContent || '');
						if (/close|关闭|返回|back/i.test(label)) window.setTimeout(() => { setDetailsOpen(false); }, 120);
						return;
					}
					// 真正的交互控件（复制、链接、输入框）交给它们自己处理。
					if (target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null) return;
					// 工具行是 div[role="button"]（ui-tool 的 ToolCallTree），
					// 所以这里不能把 role="button" 一并排除掉。
					const row = target.closest('[role="button"]');
					if (row === null || row.closest('[data-slot^="conversation"]') === null) return;
					const callId = findCallId(row);
					if (callId === null) return;
					const props = findInjectedProps(row);
					if (props !== null) props.openDetails({ callId });
					else ctx.layout.openDetails();
					setDetailsOpen(true);
				};
				document.addEventListener('click', onDetailsClick, true);

				// 安全区需要 viewport-fit=cover；卸载时还原原始 content。
				const meta = document.querySelector('meta[name="viewport"]');
				const previousMeta = meta === null ? null : meta.getAttribute('content');
				if (meta !== null && previousMeta !== null && !previousMeta.includes('viewport-fit')) {
					meta.setAttribute('content', previousMeta + ', viewport-fit=cover');
				}

				media = window.matchMedia('(max-width: ' + BREAKPOINT + 'px)');
				const onMediaChange = () => { syncMode(); };
				media.addEventListener('change', onMediaChange);

				ensureChrome();
				syncMode();
				watchFrame();

				// React 首帧晚于本插件挂载：用一次子树观察补上主框架。
				bodyObserver = new MutationObserver(() => { watchFrame(); markColumns(); markOverlays(); });
				bodyObserver.observe(document.body, { childList: true, subtree: true });

				return () => {
					if (bodyObserver !== null) bodyObserver.disconnect();
					if (frameObserver !== null) frameObserver.disconnect();
					if (media !== null) media.removeEventListener('change', onMediaChange);
					document.removeEventListener('click', onDocumentClick, true);
					document.removeEventListener('click', onDetailsClick, true);
					if (scrim !== null) { scrim.remove(); scrim = null; }
					if (fab !== null) { fab.remove(); fab = null; }
					if (detailsFab !== null) { detailsFab.remove(); detailsFab = null; }
					if (meta !== null && previousMeta !== null) meta.setAttribute('content', previousMeta);
					html.removeAttribute('data-dshm');
					html.removeAttribute('data-dshm-drawer');
					html.removeAttribute('data-dshm-details');
				};
			}, PLUGIN_ID + ': touch shell');
		}

		/**
		 * 插件主体。
		 * @param ctx - 客户端 cordis 上下文。
		 */
		/**
		 * 底部弹出菜单让位。
		 *
		 * DSH 的模型 / 推理等级 / 权限菜单都从输入框卡片**内部**那一行按钮向上展开
		 * （ModelSelect.tsx：`y = rect.top - 8 - lh`；Menu.tsx：`y = rect.top - lh - 4`），
		 * 在 390px 窄屏上必然一头压住卡片自己的文本框 —— 看起来就是「菜单和输入框抢地盘」。
		 *
		 * 上游把坐标写在 inline 的 left/top 上，transform 是空着的，所以这里用 transform
		 * 把菜单整体抬到卡片上沿之外：不动上游 DOM、不动上游定位，上游反复重排也冲不掉它。
		 * 判定刻意保守，只认「菜单底边落在卡片上下沿之间」的那一类，即从卡片内部向上弹的菜单；
		 * 向下展开的菜单（如工作区选择器）底边落在卡片下方，原样放行。
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function mountMenuLift(ctx) {
			ctx.effect(() => {
				if (typeof window === 'undefined') return;
				const GAP = 8;
				const TOP_SAFE = 12;
				const MARGIN_X = 16;
				/**
				 * 页面里可见的菜单浮层。
				 *
				 * 本机 rc.7 有两类，不能只看 position / z-index：
				 *   ① ui-primitives 的 portal 菜单 → 挂 body 下，fixed + z 1100（工作区选择器）；
				 *   ② ModelSelect 自己的卡片 → absolute + z 20，挂在触发按钮的 .root 里（不是 portal）。
				 * 两类都吃 role="menu"，按 role 找最省事。
				 */
				const menuSurfaces = () => {
					const found = [];
					for (const el of document.querySelectorAll('[role="menu"], [role="listbox"]')) {
						if (el.offsetHeight === 0) continue;
						if (el.hasAttribute('data-dshm-col')) continue;
						found.push(el);
					}
					return found;
				};
				/**
				 * 菜单卡片必须停在这条线之上。
				 *
				 * 除了输入框上沿，还要算上输入框上方那块审批面板（`data-approval-key`）——
				 * 它同样是要用户点 ✓/✗ 的东西，被菜单压住就没法操作了。
				 */
				const floorOf = (box) => {
					let top = box.top;
					for (const el of document.querySelectorAll('[data-approval-key]')) {
						const r = el.getBoundingClientRect();
						if (r.height === 0) continue;
						if (r.bottom <= box.top + 4 && r.top < top) top = r.top;
					}
					return top;
				};
				/**
				 * 同时只留一个菜单。
				 *
				 * 上游两个菜单监听的是**不同的**关闭事件：ModelSelect 用 `mousedown`，
				 * Menu 用 `pointerdown`。触摸端只要漏掉其中一个，两个菜单就会一起挂在
				 * 屏幕上，而且抬升后底边对齐、直接叠死。
				 * 这里借它们各自的 outside-click 逻辑把旧的那个收掉 —— 事件目标必须
				 * 落在菜单之外才会生效，所以派给 body。
				 */
				const born = new WeakMap();
				const tried = new WeakSet();
				const overlaps = (a, b) => !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
				const enforceSingle = (list) => {
					if (list.length <= 1) return;
					// 只有真叠在一起才干预：主菜单 + 子菜单是正常并存，不能误伤。
					const rects = list.map((el) => el.getBoundingClientRect());
					let conflict = false;
					for (let i = 0; i < rects.length && !conflict; i += 1) {
						for (let j = i + 1; j < rects.length; j += 1) {
							if (overlaps(rects[i], rects[j])) { conflict = true; break; }
						}
					}
					if (!conflict) return;
					for (const el of list) if (!born.has(el)) born.set(el, performance.now());
					let keep = list[0];
					for (const el of list) if (born.get(el) >= born.get(keep)) keep = el;
					for (const el of list) {
						if (el === keep || tried.has(el)) continue;
						tried.add(el);
						document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
						document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
					}
				};
				const sync = (list) => {
					const card = document.querySelector('[data-composer-card]');
					if (card === null) return;
					const box = card.getBoundingClientRect();
					const limit = floorOf(box);
					const vw = window.innerWidth;
					for (const el of list) {
						// 量原始位置前先摘掉上一次的位移，否则 rect 会把位移一起量进去、越推越远。
						el.style.transform = '';
						el.style.marginLeft = '';
						const rect = el.getBoundingClientRect();
						// 横向：菜单是 right:0 右对齐触发按钮，比按钮宽出不少时左边缘会顶出屏幕
						// （360px 屏实测到过 -15px，因为模型按钮只有 118px 宽）。
						// 必须用 transform 推：right:0 的元素 margin-left 不参与定位，推不动。
						let shiftX = 0;
						if (rect.left < MARGIN_X) shiftX = MARGIN_X - rect.left;
						else if (rect.right > vw - MARGIN_X) shiftX = vw - MARGIN_X - rect.right;
						// 纵向：抬到输入框（含其上方审批面板）上沿之外；底边不在参考线以下的
						// （如向下展开的工作区选择器）放行。
						let shiftY = 0;
						const need = rect.bottom + GAP - limit;
						if (rect.bottom > limit && rect.bottom <= box.bottom + 4 && need > 0) {
							shiftY = -Math.min(need, Math.max(0, rect.top - TOP_SAFE));
						}
						if (shiftX === 0 && shiftY === 0) continue;
						el.style.transform = 'translate(' + Math.round(shiftX) + 'px, ' + Math.round(shiftY) + 'px)';
					}
				};
				// 上游是「先测量、后定位」的两段式放置，所以一轮连续算几帧把那两帧盖住；
				// 之后交给尺寸观察，不常驻 rAF 空转（sync 会强制一次布局，手机上不能每帧跑）。
				let scheduled = false;
				const schedule = () => {
					if (scheduled) return;
					scheduled = true;
					let left = 6;
					const run = () => {
						const list = menuSurfaces();
						enforceSingle(list);
						sync(list);
						left -= 1;
						if (left > 0) requestAnimationFrame(run);
						else scheduled = false;
					};
					requestAnimationFrame(run);
				};
				// 菜单异步换内容会改高度（模型目录加载、二级面板切换），尺寸一变就重算。
				const resizer = new ResizeObserver(() => { schedule(); });
				const onMutate = () => {
					for (const el of menuSurfaces()) resizer.observe(el);
					schedule();
				};
				const observer = new MutationObserver(onMutate);
				// aria-expanded 翻转是菜单开合最省事的信号，不必等子树变化。
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ['aria-expanded'],
				});
				onMutate();
				return () => {
					observer.disconnect();
					resizer.disconnect();
				};
			}, PLUGIN_ID + ': menu lift');
		}

		function apply(ctx) {
			installStyles(ctx);
			mountTouchShell(ctx);
			mountMenuLift(ctx);
			exposeLayoutBridge(ctx);
		}

		/**
		 * 暴露详情浮层的开合入口，供触摸端界面与排障使用。
		 *
		 * ⚠ 这里**不能**转调上游的 openDetails()：rc.7 的实现是
		 *   `openDetails: (d) => { if (d.details === 0) d.details = 360 }`，
		 *   而 computeColumns 要 `56 + 300 + 640 <= viewport` 才给第三列宽度，
		 *   390px 屏上恒不成立。所以 open/close 直接翻转插件自己的标记。
		 *   （master 分支已把详情栏改名 openRightbar/closeRightbar，本机
		 *   dsh-termux@0.1.0-rc.7 是 openDetails/closeDetails —— 两边没有交集。）
		 * @param ctx - 客户端 cordis 上下文。
		 */
		function exposeLayoutBridge(ctx) {
			if (typeof window === 'undefined') return;
			const layout = ctx.layout;
			const bridge = {
				open: () => { document.documentElement.setAttribute('data-dshm-details', '1'); },
				close: () => { document.documentElement.removeAttribute('data-dshm-details'); },
				toggleSidebar: () => { layout.toggleSidebar(); },
			};
			window.__dshm = bridge;
			ctx.effect(() => () => {
				if (window.__dshm === bridge) delete window.__dshm;
			}, PLUGIN_ID + ': layout bridge');
		}

		/** 详情栏开合经由 layout 服务，故声明该依赖。 */
		const inject = ['layout'];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
