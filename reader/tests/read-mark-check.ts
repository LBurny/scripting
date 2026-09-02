// tests/read-mark-check.ts — 已读标记方式回归测试（设置默认值/回退/持久化 + 三处源码接线）
// run: scripting-ts run tests/read-mark-check.ts
// FileManager 是运行时全局，勿 import；结果写工作区 read-mark-check-result.txt
import { loadSettings, saveSettings } from "../lib/store"

const OUT = FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/read-mark-check-result.txt"
const SETTINGS = FileManager.appGroupDocumentsDirectory + "/reader/settings.json"

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
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub)) throw new Error(`expected to contain ${JSON.stringify(sub)}`)
    },
  }
}

async function main() {
  // loadSettings 有进程级 settingsCache（一进程只首读有效）：
  // 非法值断言必须在首次 loadSettings 前写好精心构造的文件；saveSettings 会更新缓存，往返断言有效。
  const backup = FileManager.existsSync(SETTINGS) ? FileManager.readAsStringSync(SETTINGS) : null
  try {
    await test("非法值回退默认（open=true, scroll=false）", () => {
      FileManager.writeAsStringSync(SETTINGS, JSON.stringify({ darkReadTheme: "ink", markReadOnOpen: "x", markReadOnScroll: 1 }))
      const s = loadSettings()
      expect((s as any).markReadOnOpen).toBe(true)
      expect((s as any).markReadOnScroll).toBe(false)
    })
    await test("saveSettings 往返持久化", () => {
      const s = loadSettings()
      saveSettings({ ...s, markReadOnOpen: false, markReadOnScroll: true } as any)
      const s2 = loadSettings()
      expect((s2 as any).markReadOnOpen).toBe(false)
      expect((s2 as any).markReadOnScroll).toBe(true)
    })
    await test("ArticleView 两处 markRead 受 markReadOnOpen 门控", () => {
      const src = readSrc("views/ArticleView.tsx")
      expect(src).toContain("markReadOnOpen")
      if ((src.match(/markRead\(/g) ?? []).length < 2) throw new Error("markRead 调用点不足 2 处")
    })
    await test("ArticleListView 划过标记接线（onScrollTargetVisibilityChange + markReadOnScroll + markRead）", () => {
      const src = readSrc("views/ArticleListView.tsx")
      // List 不支持滚动目标回调（scroll-probe 实测），必须用 ScrollView+LazyVStack
      expect(src).toContain("ScrollView")
      expect(src).toContain("scrollTargetLayout")
      expect(src).toContain("onScrollTargetVisibilityChange")
      expect(src).toContain("markReadOnScroll")
      expect(src).toContain("markRead")
    })
    await test("灭灯走行级 readBus（不依赖 LazyVStack 子节点属性更新）", () => {
      const src = readSrc("views/ArticleListView.tsx")
      expect(src).toContain("readBus")
      expect(src).toContain("emitReadBus")
      // 行组件自持 tick 订阅
      expect(src).toContain("readBus.add")
    })
    await test("Tab 重选重载接线（app.tsx 传 selection/tabIndex）", () => {
      const src = readSrc("app.tsx")
      const n = (src.match(/selection=\{selection\} tabIndex=\{[0-9]\}/g) ?? []).length
      if (n < 6) throw new Error(`selection/tabIndex 传参点不足 6 处（首页 3 + 全屏 3），实际 ${n}`)
      const vsrc = readSrc("views/ArticleListView.tsx")
      expect(vsrc).toContain("selection?.subscribe")
    })
    await test("SettingsView 已读标记 Section（两个 Toggle 行）", () => {
      const src = readSrc("views/SettingsView.tsx")
      expect(src).toContain("已读标记")
      expect(src).toContain("markReadOnOpen")
      expect(src).toContain("markReadOnScroll")
    })
  } finally {
    if (backup !== null) FileManager.writeAsStringSync(SETTINGS, backup)
  }

  const fails = lines.filter(l => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}
main().catch((e) => {
  // 兜底：模块导入失败（实现未创建时）也要留下 RED 证据
  lines.push(`FAIL: main — ${e?.message ?? e}`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
})
