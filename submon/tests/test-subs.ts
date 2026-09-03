// test-subs.ts — lib/subs.ts 测试 · run: scripting-ts run <abs>/submon/tests/test-subs.ts
// FileManager is a runtime global (no import).
import { normalizeUrl, loadSubs, saveSubs, addSub, updateSub, removeSub } from "../lib/subs"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-subs.txt"
// 测试写的是真机数据文件：跑前快照，跑后还原，绝不清空用户数据
const DATA_FILE = FileManager.appGroupDocumentsDirectory + "/submon/subscriptions.json"
const ORIG_DATA: string | null = FileManager.existsSync(DATA_FILE) ? FileManager.readAsStringSync(DATA_FILE) : null
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
const throws = async (msg: string, fn: () => any) => {
  let caught: any = null
  try { await fn() } catch (e: any) { caught = e }
  if (!caught) throw new Error(`expected throw ${msg}, but resolved`)
  if (!String(caught?.message ?? caught).includes(msg)) throw new Error(`expected throw ${msg}, got ${caught?.message ?? caught}`)
}

async function run() {
  await Promise.all([
    test("normalizeUrl 带协议原样", () => expect(normalizeUrl(" https://a.com/sub ")).toBe("https://a.com/sub")),
    test("normalizeUrl 裸域名补 https", () => expect(normalizeUrl("a.com/sub")).toBe("https://a.com/sub")),
    test("normalizeUrl http 不升级", () => expect(normalizeUrl("http://a.com/sub")).toBe("http://a.com/sub")),
    test("CRUD 全流程：add/dedupe/update/remove", async () => {
      saveSubs([]) // reset
      expect(loadSubs()).toEqual([])
      const a = await addSub("example.com/sub?token=1", "测试一", "clash")
      expect(a.url).toBe("https://example.com/sub?token=1")
      expect(a.name).toBe("测试一")
      expect(a.ua).toBe("clash")
      expect(a.addedAt > 0).toBe(true)
      await addSub("https://b.com/sub", "")
      expect(loadSubs().length).toBe(2)
      expect(loadSubs()[1].name).toBe("我的订阅") // 空名兜底
      await throws("该订阅已存在", () => addSub("https://b.com/sub", "重复"))
      // 落盘验证：绕过内存缓存直接重读 JSON 文件
      const raw = JSON.parse(FileManager.readAsStringSync(
        FileManager.appGroupDocumentsDirectory + "/submon/subscriptions.json")) as any[]
      expect(raw.length).toBe(2)
      updateSub("https://b.com/sub", { name: "改名", ua: "surge" })
      expect(loadSubs().find((s: any) => s.url === "https://b.com/sub")).toEqual({
        url: "https://b.com/sub", name: "改名", ua: "surge", addedAt: raw[1].addedAt,
      })
      removeSub("https://example.com/sub?token=1")
      expect(loadSubs().map((s: any) => s.url)).toEqual(["https://b.com/sub"])
    }),
  ])
  try { FileManager.writeAsStringSync(DATA_FILE, ORIG_DATA ?? "[]") } catch {} // teardown：还原真实数据
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()