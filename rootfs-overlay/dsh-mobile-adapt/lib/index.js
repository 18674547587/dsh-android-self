/**
 * dsh-mobile-adapt —— 宿主半侧入口。
 *
 * 本插件的全部行为都在浏览器半侧（`./client`）完成：它只操作 DOM 与样式，
 * 不需要宿主服务、配置或 RPC，因此宿主半侧是一个空实现——与官方
 * `@deepseek-ai/dsh-client-ui-layout` 的宿主入口同构。
 */

/** 宿主侧无行为。 */
export function apply() {}
