// tests/theme-html-check.ts — articleHtml 深色主题/亮度/切篇淡入回归测试
// 运行：scripting-ts run <本文件>；结果写工作区 theme-html-check-result.txt
import { articleHtml, DARK_THEMES } from "../lib/util"

const lines: string[] = []
let failed = 0
function check(name: string, ok: boolean, detail = "") {
  lines.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
  if (!ok) failed++
}

const meta = { title: "t", feedTitle: "f", date: 0, link: "https://example.com/a" }

// 三种主题底色各自出现在对应深色 CSS 中
const ink = articleHtml(meta, "x", { theme: "ink" })
const black = articleHtml(meta, "x", { theme: "black" })
const gray = articleHtml(meta, "x", { theme: "gray" })
check("ink bg #0d1117", ink.includes("background: #0d1117"))
check("black bg #000000", black.includes("background: #000000"))
check("gray bg #1c1c1e", gray.includes("background: #1c1c1e"))
check("gray pre #2c2c2e", gray.includes("pre { background: #2c2c2e; }"))
check("black pre #1c1c1e", black.includes("pre { background: #1c1c1e; }"))

// 字体亮度：0.7 应产出混合后的文字色（与 100% 时不同），且底色不变
const dim = articleHtml(meta, "x", { theme: "ink", textBrightness: 0.7 })
const full = articleHtml(meta, "x", { theme: "ink", textBrightness: 1 })
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (fg: string, bg: string, toBg: number) => {
  const f = rgb(fg), b = rgb(bg)
  const c = f.map((v, i) => Math.round(v + (b[i] - v) * toBg))
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("")
}
const expect70 = mix(DARK_THEMES.ink.text, DARK_THEMES.ink.bg, 0.3)
check("text brightness 0.7 mixed color", dim.includes(`color: ${expect70}`), expect70)
check("text brightness 1 uses raw color", full.includes(`color: ${DARK_THEMES.ink.text}`))
check("dim differs from full", !dim.includes(`color: ${DARK_THEMES.ink.text}`))

// 图片亮度：<1 注入 filter，=1 不注入
const imgDim = articleHtml(meta, "x", { theme: "ink", imageBrightness: 0.6 })
check("image brightness 0.6 filter", imgDim.includes("filter: brightness(0.6)"))
check("image brightness 1 no filter", !full.includes("filter: brightness"))

// 不传 prefs 时回退默认（微蓝黑、无 filter、原文字色）
const dflt = articleHtml(meta, "x")
check("default falls back to ink", dflt.includes("background: #0d1117"))
check("default no filter", !dflt.includes("filter: brightness"))
check("default raw text color", dflt.includes(`color: ${DARK_THEMES.ink.text}`))

// 浅色模式始终白底黑字（不受深色设置影响）
check("light block intact", ink.includes("background: #fff; color: #1c1c1e;"))

// 翻页动画（2026-09-01 设置化：none/fade/slide）：transition 注入 keyframes + 尊重系统减弱动态效果；默认不注入
const fade = articleHtml(meta, "x", { theme: "ink", transition: "fade" })
check("fade injects keyframes", fade.includes("@keyframes readerFadeIn"))
check("fade animates body", fade.includes("body { animation: readerFadeIn"))
check("fade respects reduced motion", fade.includes("prefers-reduced-motion: no-preference"))
check("no transition => no animation", !full.includes("readerFadeIn") && !full.includes("readerSlideIn"))
check("default => no animation", !dflt.includes("readerFadeIn") && !dflt.includes("readerSlideIn"))

// 横向滑入（方案甲：仅新页滑入，零延迟）：方向决定起始位移；overflow-x 防动画期横向溢出闪滚动条
const slideR = articleHtml(meta, "x", { theme: "ink", transition: "slide", slideFrom: "right" })
const slideL = articleHtml(meta, "x", { theme: "ink", transition: "slide", slideFrom: "left" })
check("slide injects keyframes", slideR.includes("@keyframes readerSlideIn"))
check("slide from right starts at +100%", slideR.includes("translateX(100%)"))
check("slide from left starts at -100%", slideL.includes("translateX(-100%)"))
check("slide hides x overflow", slideR.includes("overflow-x: hidden"))
check("slide respects reduced motion", slideR.includes("prefers-reduced-motion: no-preference"))
check("slide => no fade keyframes", !slideR.includes("readerFadeIn"))

// html 常驻主题底色：body 淡入初期透明，露出的是 html 同色底而非 WKWebView 默认白底
check("html bg dark pinned", ink.includes("html { background: #0d1117; }"))
check("html bg light pinned", ink.includes("html { background: #fff; }"))

FileManager.writeAsStringSync(
  FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/theme-html-check-result.txt",
  lines.join("\n") + (failed ? `\n\n${failed} FAILED` : "\n\nALL PASS"),
)
