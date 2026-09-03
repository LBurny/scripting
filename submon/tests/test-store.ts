// test-store.ts — lib/store.ts + lib/bus.ts 测试（fake fetcher，无网络）· run: scripting-ts run <abs>/submon/tests/test-store.ts
// FileManager is a runtime global (no import).
import { loadStates, saveStates, refreshAll } from "../lib/store"
import { onDataChanged, emitDataChanged } from "../lib/bus"
import type { TrafficInfo } from "../lib/traffic"
import type { Sub } from "../lib/subs"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-store.txt"
// 测试写的是真机数据文件：跑前快照，跑后还原
const DATA_FILE = FileManager.appGroupDocumentsDirectory + "/submon/traffic.json"
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

const INFO: TrafficInfo = { upload: 1, download: 2, total: 10, expire: 1893456000 }
const SUBS: Sub[] = [{ url: "u1", name: "一号", addedAt: 1 }, { url: "u2", name: "二号", addedAt: 2 }]

async function run() {
  await Promise.all([
    test("bus：订阅/退订与广播", () => {
      let n = 0
      const off1 = onDataChanged(() => n++)
      const off2 = onDataChanged(() => n++)
      emitDataChanged()
      expect(n).toBe(2)
      off1()
      emitDataChanged()
      expect(n).toBe(3)
      off2()
      emitDataChanged()
      expect(n).toBe(3)
    }),
    test("refreshAll：成功写入 / 失败保留 info / 空订阅不写", async () => {
      saveStates({}) // reset
      const okFetcher = async (_s: any) => INFO
      await refreshAll(okFetcher, SUBS)
      const s1 = loadStates()
      expect(s1["u1"].info).toEqual(INFO)
      expect(s1["u1"].error).toBe(null)
      expect(s1["u1"].updatedAt > 0).toBe(true)
      expect(s1["u2"].info).toEqual(INFO)

      const failFetcher = async (_s: any) => { throw new Error("HTTP 403") }
      const prevUpdated = loadStates()["u1"].updatedAt
      await refreshAll(failFetcher, SUBS)
      const s2 = loadStates()
      expect(s2["u1"].error).toBe("HTTP 403")
      expect(s2["u1"].info).toEqual(INFO) // 旧 info 不丢
      expect(s2["u1"].updatedAt).toBe(prevUpdated) // updatedAt 不变
      expect(s2["u1"].attemptedAt >= prevUpdated).toBe(true)

      await refreshAll(okFetcher, []) // 空订阅：不产生脏数据
      expect(loadStates()).toEqual(s2)
    }),
  ])
  try { FileManager.writeAsStringSync(DATA_FILE, ORIG_DATA ?? "{}") } catch {} // teardown：还原真实数据
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()