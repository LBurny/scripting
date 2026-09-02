// lib/util.ts

import { GESTURE_JS, GESTURE_CSS } from "./gestures"

export function relativeTime(ts: number): string {
  if (!ts) return ""
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 转义 HTML 文本 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** 深色阅读主题：仅影响深色模式下的文章正文配色（浅色模式始终白底） */
export type DarkReadTheme = "ink" | "black" | "gray"

/** 三种深色阅读风格（label 用于设置页展示；swatch 实际取 bg/text） */
export const DARK_THEMES: Record<DarkReadTheme, { label: string; bg: string; text: string; pre: string }> = {
  /** 微蓝黑：带一点蓝调的黑（GitHub Dark），长时间阅读柔和不刺眼 */
  ink: { label: "微蓝黑", bg: "#0d1117", text: "#e6e6eb", pre: "#161b22" },
  /** 纯黑：OLED 省电黑背景 */
  black: { label: "纯黑", bg: "#000000", text: "#f2f2f7", pre: "#1c1c1e" },
  /** 深灰：与文章列表底色同档的炭灰 */
  gray: { label: "深灰", bg: "#1c1c1e", text: "#ededf0", pre: "#2c2c2e" },
}

/** 生成阅读页 HTML（自动适配深浅色；标题与元信息渲染在正文头部；
 *  prefs 控制深色模式下的风格：底色主题 / 字体亮度 / 图片亮度；
 *  transition 换页动画（仅用于换文/换全文，首期打开不传）：
 *  "fade"=200ms 淡入；"slide"=新页从 slideFrom 侧横向滑入（默认 right，左滑下一篇=从右滑入）；
 *  缺省=无动画。动画包在 prefers-reduced-motion: no-preference 内（尊重系统减弱动态效果）。
 *  注意 html 元素常驻主题底色：body 动画初期透明/移出，露出的是 html 同色底，
 *  而不是 WKWebView 默认白底（深色下防闪白的关键）。 */
export function articleHtml(
  meta: { title: string; feedTitle: string; date: number; author?: string; link?: string },
  content: string,
  prefs: { theme?: DarkReadTheme; textBrightness?: number; imageBrightness?: number; transition?: "fade" | "slide"; slideFrom?: "left" | "right" } = {},
): string {
  const dk = DARK_THEMES[prefs.theme ?? "ink"]
  // 字体亮度：把字体色向底色混合（比值 0 = 完全融入底，1 = 原色）；仅影响正文主色，链接/元信息不变
  const tb = Math.min(1, Math.max(0.5, prefs.textBrightness ?? 1))
  // 图片亮度：CSS filter brightness（仅深色模式）
  const ib = Math.min(1, Math.max(0.4, prefs.imageBrightness ?? 1))
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const mix = (fg: string, bg: string, toBg: number) => {
    const f = rgb(fg), b = rgb(bg)
    const c = f.map((v, i) => Math.round(v + (b[i] - v) * toBg))
    return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("")
  }
  const effText = mix(dk.text, dk.bg, 1 - tb)
  const imgFilter = ib < 1 ? `  img, video { filter: brightness(${ib}); }
` : ""
  // 换页动画：尊重系统「减弱动态效果」（开启时媒体查询不命中，无动画）
  // slide 时 html overflow-x hidden：防 0.2s 动画期内横向溢出闪滚动条（pre 内部自滚动不受影响）
  let enterAnim = ""
  if (prefs.transition === "fade") {
    enterAnim = `  @media (prefers-reduced-motion: no-preference) {
    body { animation: readerFadeIn .2s ease-out; }
    @keyframes readerFadeIn { from { opacity: 0; } to { opacity: 1; } }
  }
`
  } else if (prefs.transition === "slide") {
    const fromX = prefs.slideFrom === "left" ? "-100%" : "100%"
    enterAnim = `  @media (prefers-reduced-motion: no-preference) {
    html { overflow-x: hidden; }
    body { animation: readerSlideIn .2s ease-out; }
    @keyframes readerSlideIn { from { transform: translateX(${fromX}); opacity: .5; } to { transform: none; opacity: 1; } }
  }
`
  }
  const metaLine = [relativeTime(meta.date), meta.author].filter(Boolean).join(" · ")
  const header = `<div class="a-source">${escapeHtml(meta.feedTitle)}</div>
<h1 class="a-title">${escapeHtml(meta.title)}</h1>
<div class="a-meta">${escapeHtml(metaLine)}</div>`
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
${meta.link ? `<base href="${escapeHtml(meta.link)}">` : ""}
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, system-ui, sans-serif;
    font-size: 17px; line-height: 1.75;
    margin: 0; padding: 14px 18px 40px;
    -webkit-text-size-adjust: 100%;
    ${GESTURE_CSS}
  }
  @media (prefers-color-scheme: dark) {
    html { background: ${dk.bg}; }
    body { background: ${dk.bg}; color: ${effText}; }
    a { color: #64d2ff; }
${imgFilter}}
  @media (prefers-color-scheme: light) {
    html { background: #fff; }
    body { background: #fff; color: #1c1c1e; }
    a { color: #0a84ff; }
  }
  .a-source { font-size: 13px; color: #8e8e93; margin-bottom: 8px; }
  .a-title { font-size: 22px; font-weight: 700; line-height: 1.35; margin: 0 0 8px; }
  .a-meta {
    font-size: 13px; color: #8e8e93;
    margin-bottom: 22px; padding-bottom: 14px;
    border-bottom: 0.5px solid rgba(142,142,147,0.35);
  }
  img, video { max-width: 100%; height: auto; border-radius: 8px; }
  pre { overflow-x: auto; padding: 12px; border-radius: 8px; font-size: 14px; }
  /* 代码块底色与正文同色系、亮一档，层次自然 */
  @media (prefers-color-scheme: dark) { pre { background: ${dk.pre}; } }
  @media (prefers-color-scheme: light) { pre { background: #f2f2f7; } }
  blockquote {
    margin: 0; padding: 2px 14px;
    border-left: 3px solid #8e8e93; opacity: 0.85;
  }
  h1, h2, h3 { line-height: 1.35; }
${enterAnim}</style>
<script>${GESTURE_JS}</script>
</head>
<body>${header}${content || ""}</body>
</html>`
}
