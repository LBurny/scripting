// test-convertStore.ts — lib/convertStore.ts 持久化测试 · run: scripting-ts run "<abs>/submon/tests/test-convertStore.ts"
// FileManager is a runtime global (no import).
import {
  loadHistory, addHistory, removeHistory, clearHistory,
  loadCustom, saveCustom, loadLastForm, saveLastForm,
} from "../lib/convertStore"
import type { ConvertHistoryEntry } from "../lib/convertStore"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-convertStore.txt"
// 测试写的是真机数据文件：跑前快照，跑后还原
const DATA_DIR = FileManager.appGroupDocumentsDirectory + "/submon"
const DATA_FILES = ["/convert_history.json", "/convert_custom.json", "/convert_form.json"]
const ORIG_DATA: (string | null)[] = DATA_FILES.map((f) =>
  FileManager.existsSync(DATA_DIR + f) ? FileManager.readAsStringSync(DATA_DIR + f) : null)
const lines: string[] = []
const test = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve().then(fn)
    .then(() => lines.push(`PASS: ${name}`))
    .catch((e) => lines.push(`FAIL: ${name} — ${e}`))
const deepEq = (a: any, b: any): boolean => {
  if (a === b) return true
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEq(a[k], b[k]))
}
const expect = (a: any) => ({
  toBe: (e: any) => { if (a !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
  toEqual: (e: any) => { if (!deepEq(a, e)) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
})

const entry = (url: string, target = "clash") => ({
  url, backend: "https://api.dler.io/sub?", target, config: "", urls: [url],
})

async function run() {
  await Promise.all([
    test("addHistory：自动补 id/createdAt、置顶、落盘 roundtrip", () => {
      clearHistory()
      const list = addHistory(entry("https://a/1"))
      expect(list.length).toBe(1)
      expect(list[0].id.length > 0).toBe(true)
      expect(list[0].createdAt > 0).toBe(true)
      expect(list[0].url).toBe("https://a/1")
      const reloaded: ConvertHistoryEntry[] = loadHistory()
      expect(reloaded.length).toBe(1)
      expect(reloaded[0]).toEqual(list[0])
    }),
    test("addHistory：同 url 去重移到最前，不新增", () => {
      clearHistory()
      addHistory(entry("https://a/1"))
      addHistory(entry("https://b/2"))
      addHistory(entry("https://c/3"))
      expect(loadHistory().map((h) => h.url)).toEqual(["https://c/3", "https://b/2", "https://a/1"])
      addHistory(entry("https://a/1"))
      const list = loadHistory()
      expect(list.length).toBe(3)
      expect(list[0].url).toBe("https://a/1")
    }),
    test("addHistory：cap 30，最新在前", () => {
      clearHistory()
      for (let i = 0; i < 35; i++) addHistory(entry(`https://x/${i}`))
      const list = loadHistory()
      expect(list.length).toBe(30)
      expect(list[0].url).toBe("https://x/34")
      expect(list[29].url).toBe("https://x/5")
    }),
    test("removeHistory：按 id 删除", () => {
      clearHistory()
      const list = addHistory(entry("https://a/1"))
      const id = list[0].id
      addHistory(entry("https://b/2"))
      const after = removeHistory(id)
      expect(after.map((h) => h.url)).toEqual(["https://b/2"])
      expect(loadHistory().map((h) => h.url)).toEqual(["https://b/2"])
    }),
    test("clearHistory：清空并落盘", () => {
      addHistory(entry("https://a/1"))
      clearHistory()
      expect(loadHistory()).toEqual([])
    }),
    test("loadCustom/saveCustom：roundtrip 与缺省值", () => {
      saveCustom({ backends: ["https://my.dev/sub?"], configs: ["https://my.dev/rules.ini"] })
      expect(loadCustom()).toEqual({ backends: ["https://my.dev/sub?"], configs: ["https://my.dev/rules.ini"] })
      saveCustom({ backends: [], configs: [] })
      expect(loadCustom()).toEqual({ backends: [], configs: [] })
    }),
    test("loadLastForm/saveLastForm：任意 JSON roundtrip", () => {
      saveLastForm({ urlText: "https://a/1", target: "surge&ver=4", custom: true })
      expect(loadLastForm()).toEqual({ urlText: "https://a/1", target: "surge&ver=4", custom: true })
      saveLastForm({})
      expect(loadLastForm()).toEqual({})
    }),
  ])
  // teardown：还原真实数据
  const FALLBACK = ["[]", "{\"backends\":[],\"configs\":[]}", "{}"]
  DATA_FILES.forEach((f, i) => {
    try { FileManager.writeAsStringSync(DATA_DIR + f, ORIG_DATA[i] ?? FALLBACK[i]) } catch {}
  })
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()