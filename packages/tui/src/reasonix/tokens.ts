/** Theme tokens adapted from Reasonix for covalo.
 *  Colors are cast to `any` because @covalo/ink's type system expects
 *  Color | keyof Theme, but hex strings work at runtime. */

/**
 * 主题颜色令牌接口。
 * @remarks 修改此接口或 dark 对象中的色值即可全局更改 TUI 配色。
 *
 * @field fg     - 前景色层级：strong（最亮，标题）→ body（正文）→ sub（次要文字）→ meta（元数据）→ faint（最淡，辅助标记）
 * @field tone   - 功能色调：brand（品牌绿，流式卡片头部）→ accent（品牌蓝，强调）→ ok（成功绿）→ warn（警告黄）→ err（错误红）→ info（信息蓝）
 * @field surface - 表面色层级：bg（最底层，大背景）→ bgInput（输入框底色）→ bgCode（代码块底色）→ bgElev（弹起卡片，卡片容器）
 */
export interface ThemeTokens {
  fg: { strong: string; body: string; sub: string; meta: string; faint: string };
  tone: { brand: string; accent: string; ok: string; warn: string; err: string; info: string };
  surface: { bg: string; bgInput: string; bgCode: string; bgElev: string };
}

/**
 * 深色主题颜色定义 — new_tui 风格。
 * 所有组件通过 FG / TONE / SURFACE 代理引用此处色值，修改此对象即可全局换肤。
 *
 * 配色思路：暗色画布（bg: #050505）、蓝紫强调色（brand/accent: #3b82f6/#a855f7）、琥珀警告色（warn: #f59e0b）。
 * - fg.strong    (#e0e0e0) 标题/高亮文字
 * - fg.body      (#85a9ff) 正文（终端蓝调）
 * - fg.sub       (#9ca3af) 次要文字（gray-400）
 * - fg.meta      (#6b7280) 元数据标签（gray-500）
 * - fg.faint     (#4b5563) 最淡文字（gray-600）
 * - tone.brand   (#3b82f6) 品牌蓝：StreamingCard 头部、主角色
 * - tone.accent  (#a855f7) 品牌紫：强调色、活动状态
 * - tone.ok      (#00ff41) 成功绿：完成状态
 * - tone.warn    (#f59e0b) 警告琥珀：待定状态
 * - tone.err     (#ef4444) 错误红：失败状态
 * - tone.info    (#3b82f6) 信息蓝
 * - surface.bg      (#050505) 终端大背景
 * - surface.bgInput (#0c0c0c) 输入框/卡片背景
 * - surface.bgCode  (#0c0c0c) 代码块背景
 * - surface.bgElev  (#0a0a0a) 面板/弹窗背景
 */
const dark: ThemeTokens = {
  fg: { strong: '#e0e0e0', body: '#85a9ff', sub: '#9ca3af', meta: '#6b7280', faint: '#4b5563' },
  tone: { brand: '#3b82f6', accent: '#a855f7', ok: '#00ff41', warn: '#f59e0b', err: '#ef4444', info: '#3b82f6' },
  surface: { bg: '#050505', bgInput: '#0c0c0c', bgCode: '#0c0c0c', bgElev: '#0a0a0a' },
};

// 仅在运行时需要切换主题时使用（例如用户设置偏好），当前始终使用 dark。
let activeTheme: ThemeTokens = dark;

/**
 * 切换当前主题。修改后所有通过 FG / TONE / SURFACE 代理读取的值将立即反映新主题。
 * @param theme - 新的主题令牌对象
 */
export function setActiveTheme(theme: ThemeTokens): void { activeTheme = theme; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * 创建响应式颜色令牌代理。
 * 通过 Proxy 将属性读取转发到 activeTheme，使得组件可以像访问普通对象一样使用颜色，
 * 且切换主题后无需重新渲染即可自动获取新色值。
 *
 * @param select - 从 ThemeTokens 中选取要代理的子对象（fg / tone / surface）
 * @returns 一个 Proxy 包装的对象，所有属性读取都会返回 activeTheme 中的对应值
 *
 * @remarks 返回类型为 any 是因为 Ink 的 color 属性接受 `Color | keyof Theme`，
 *          但 hex 字符串在运行时正常工作，类型声明与实际行为不一致。
 */
function proxyTokens(select: (t: ThemeTokens) => any): any {
  const target = select(dark);
  return new Proxy(target, {
    get: (_, prop: string | symbol) => select(activeTheme)[prop as string],
  });
}

/**
 * 全局前景色代理。等同于 `activeTheme.fg`，但切换主题后自动更新。
 * - FG.strong → 标题/高亮（#ffffff）
 * - FG.body   → 正文（#E1D3DC）
 * - FG.sub    → 次要文字（#8D7B88）
 * - FG.meta   → 元数据（#8D7B88）
 * - FG.faint  → 最淡文字（#5D5159）
 */
export const FG: any = proxyTokens(t => t.fg);

/**
 * 全局功能色调代理。等同于 `activeTheme.tone`，切换主题后自动更新。
 * - TONE.brand  → 品牌绿（#00FF66），流式卡片头部
 * - TONE.accent → 品牌蓝（#4A90E2），强调和信息标记
 * - TONE.ok     → 成功（#00FF66）
 * - TONE.warn   → 警告（#FFBD2E）
 * - TONE.err    → 错误（#FF5F56）
 * - TONE.info   → 信息（#4A90E2）
 */
export const TONE: any = proxyTokens(t => t.tone);

/**
 * 全局表面色代理。等同于 `activeTheme.surface`，切换主题后自动更新。
 * - SURFACE.bg      → 大背景（#000000）
 * - SURFACE.bgInput → 输入框底色（#1D3B5C）
 * - SURFACE.bgCode  → 代码块底色（#0C0C0C）
 * - SURFACE.bgElev  → 卡片底色（#13283F）
 */
export const SURFACE: any = proxyTokens(t => t.surface);
