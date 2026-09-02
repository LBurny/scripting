// tests/gesture-check.ts — 手势设置回归测试（注册表/合并/articleHtml 注入/换文渲染路径）
// run: scripting-ts run tests/gesture-check.ts
// FileManager 是运行时全局，勿 import；结果写工作区 gesture-check-result.txt
import {
  GESTURE_ACTIONS, GESTURE_ACTION_LABELS, GESTURES, DEFAULT_GESTURES, mergeGestures, GESTURE_JS,
} from "../lib/gestures"
import { articleHtml } from "../lib/util"
import { loadSettings } from "../lib/store"

const OUT = FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/gesture-check-result.txt"

/** 读脚本源码（scriptsDirectory = 脚本存储目录） */
function readSrc(rel: string): string {
  const p = FileManager.scriptsDirectory + "/reader/" + rel
  if (FileManager.existsSync(p)) return FileManager.readAsStringSync(p)
  throw new Error("源码不可读: " + p)
}

const lines: string[] = []
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn)
    .then(() => lines.push(`PASS: ${name}`))
    .catch((e) => lines.push(`FAIL: ${name} — ${e?.message ?? e}`))
}
function expect(actual: any) {
  return {
    toBe(e: any) { if (actual !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(actual)}`) },
    toEqual(e: any) { if (JSON.stringify(actual) !== JSON.stringify(e)) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(actual)}`) },
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub)) throw new Error(`expected to contain ${JSON.stringify(sub)}`)
    },
  }
}
async function main() {
  await test("注册表动作顺序（可扩展数组）", () => {
    expect(GESTURE_ACTIONS).toEqual(["none", "exit", "prevArticle", "nextArticle"])
  })
  await test("动作标签齐全", () => {
    expect(GESTURE_ACTION_LABELS.none).toBe("无操作")
    expect(GESTURE_ACTION_LABELS.exit).toBe("退出文章")
    expect(GESTURE_ACTION_LABELS.prevArticle).toBe("上一篇文章")
    expect(GESTURE_ACTION_LABELS.nextArticle).toBe("下一篇文章")
  })
  await test("手势行清单（设置页）", () => {
    expect(GESTURES.map(g => g.id)).toEqual(["doubleTap", "swipeLeft", "swipeRight"])
    expect(GESTURES.find(g => g.id === "doubleTap")!.label).toBe("双击")
  })
  await test("默认映射：双击退出/左滑下一篇/右滑上一篇（用户指定方向）", () => {
    expect(DEFAULT_GESTURES.doubleTap).toBe("exit")
    expect(DEFAULT_GESTURES.swipeLeft).toBe("nextArticle")
    expect(DEFAULT_GESTURES.swipeRight).toBe("prevArticle")
  })
  await test("mergeGestures 缺失字段回退默认映射", () => {
    expect(JSON.stringify(mergeGestures(undefined))).toBe(JSON.stringify(DEFAULT_GESTURES))
  })
  await test("mergeGestures 部分覆盖保留其余默认（新方向）", () => {
    expect(JSON.stringify(mergeGestures({ doubleTap: "none" }))).toEqual(
      JSON.stringify({ doubleTap: "none", swipeLeft: "nextArticle", swipeRight: "prevArticle" }))
  })
  await test("mergeGestures 非法值回退该项默认值（新方向）", () => {
    const m = mergeGestures({ doubleTap: "hack", swipeRight: 42 } as any)
    expect(m.doubleTap).toBe("exit")
    expect(m.swipeRight).toBe("prevArticle")
    expect(m.swipeLeft).toBe("nextArticle")
  })
  await test("loadSettings().gestures 与默认模型一致（旧文件无字段不报错）", () => {
    const g = loadSettings().gestures
    expect(typeof g.doubleTap).toBe("string")
    expect(typeof g.swipeLeft).toBe("string")
    expect(typeof g.swipeRight).toBe("string")
    expect(GESTURE_ACTIONS.includes(g.doubleTap as any)).toBe(true)
    expect(GESTURE_ACTIONS.includes(g.swipeLeft as any)).toBe(true)
    expect(GESTURE_ACTIONS.includes(g.swipeRight as any)).toBe(true)
  })
  await test("GESTURE_JS 识别三类手势并经 readerGesture 回传（v2：即时触发+touchcancel 兑底）", () => {
    expect(GESTURE_JS).toContain("readerGesture")
    expect(GESTURE_JS).toContain("touchstart")
    expect(GESTURE_JS).toContain("touchcancel")
    expect(GESTURE_JS).toContain("doubleTap")
    expect(GESTURE_JS).toContain("swipeLeft")
    expect(GESTURE_JS).toContain("swipeRight")
  })
  await test("articleHtml 注入手势脚本与 pan-y 滚动让权（修滚动接管吞手势）", () => {
    const html = articleHtml({ title: "t", feedTitle: "f", date: 1, link: "https://a.com" }, "x", { theme: "ink" })
    expect(html).toContain("messageHandlers.readerGesture")
    expect(html).toContain("touch-action: pan-y pinch-zoom")
  })
  await test("articleHtml 无 prefs 时仍注入脚本（动作映射在原生侧消费）", () => {
    const html = articleHtml({ title: "t", feedTitle: "f", date: 1 }, "x")
    expect(html).toContain("__readerGestureLoaded")
  })
  await test("ArticleView 换文不走 hidden 周期（白屏根因：藏而不揭；WKWebView commit 前自留旧页）", () => {
    const src = readSrc("views/ArticleView.tsx")
    if (src.includes("setReady(false)")) throw new Error("仍存在 setReady(false) 隐藏周期")
  })
  await test("ArticleView 手势全链路 trace 日志（真机诊断：msg→action→switch→loadHTML）", () => {
    const src = readSrc("views/ArticleView.tsx")
    expect(src).toContain("gesture-trace.log")
  })
  await test("ArticleView 换文按设置传 pageTransition 动画参数（首期加载不播动画）", () => {
    const src = readSrc("views/ArticleView.tsx")
    expect(src).toContain("pageTransition")
  })
  await test("store 设置项 pageTransition（none/fade/slide，默认 fade；旧文件回退）", () => {
    const s = loadSettings()
    expect(["none", "fade", "slide"].includes((s as any).pageTransition)).toBe(true)
    const src = readSrc("lib/store.ts")
    expect(src).toContain("pageTransition")
  })
  await test("SettingsView 翻页动画 Picker（无/淡入/横向滑动）", () => {
    const src = readSrc("views/SettingsView.tsx")
    expect(src).toContain("pageTransition")
  })

  const fails = lines.filter(l => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}
main().catch((e) => {
  // 兜底：模块导入失败（实现未创建时）也要留下 RED 证据
  lines.push(`FAIL: main — ${e?.message ?? e}`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
})
