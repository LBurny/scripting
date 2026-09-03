// test-convert.ts — lib/convert.ts 纯函数测试（无网络）· run: scripting-ts run "<abs>/submon/tests/test-convert.ts"
// FileManager is a runtime global (no import).
import {
  CONVERT_TARGETS, BUILTIN_BACKENDS, BUILTIN_CONFIGS, DEFAULT_PARAMS,
  normalizeBackend, normalizeUrlList, buildConvertUrl,
} from "../lib/convert"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-convert.txt"
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
const throws = async (fn: () => any) => {
  try { await fn() } catch { return }
  throw new Error("expected throw, but resolved")
}

async function run() {
  await Promise.all([
    test("CONVERT_TARGETS：≥14 项、值唯一、含关键 target", () => {
      expect(CONVERT_TARGETS.length >= 14).toBe(true)
      const vals = CONVERT_TARGETS.map((t) => t.value)
      expect(new Set(vals).size).toBe(vals.length)
      const has = (v: string) => vals.indexOf(v) >= 0
      expect(has("clash")).toBe(true)
      expect(has("clash.meta")).toBe(true)
      expect(has("surge&ver=4")).toBe(true)
      expect(has("quanx")).toBe(true)
      expect(has("singbox")).toBe(true)
      expect(has("trojan")).toBe(true)
      // label 均非空
      expect(CONVERT_TARGETS.every((t) => typeof t.label === "string" && t.label.length > 0)).toBe(true)
    }),
    test("BUILTIN_BACKENDS：≥4 个且均已规范为 /sub? 结尾", () => {
      expect(BUILTIN_BACKENDS.length >= 4).toBe(true)
      for (const b of BUILTIN_BACKENDS) {
        expect(b.startsWith("https://")).toBe(true)
        expect(b.endsWith("/sub?")).toBe(true)
      }
      expect(new Set(BUILTIN_BACKENDS).size).toBe(BUILTIN_BACKENDS.length)
    }),
    test("BUILTIN_CONFIGS：8 个 ACL4SSR 预设，url 均为完整 https", () => {
      expect(BUILTIN_CONFIGS.length).toBe(8)
      for (const c of BUILTIN_CONFIGS) {
        expect(c.url.startsWith("https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/")).toBe(true)
        expect(c.label.length > 0).toBe(true)
      }
    }),
    test("DEFAULT_PARAMS：emoji/udp 开，其余关，include/exclude 空", () => {
      expect(DEFAULT_PARAMS.emoji).toBe(true)
      expect(DEFAULT_PARAMS.udp).toBe(true)
      expect(DEFAULT_PARAMS.insert).toBe(false)
      expect(DEFAULT_PARAMS.tfo).toBe(false)
      expect(DEFAULT_PARAMS.scv).toBe(false)
      expect(DEFAULT_PARAMS.fdn).toBe(false)
      expect(DEFAULT_PARAMS.sort).toBe(false)
      expect(DEFAULT_PARAMS.expand).toBe(false)
      expect(DEFAULT_PARAMS.include).toBe("")
      expect(DEFAULT_PARAMS.exclude).toBe("")
    }),
    test("normalizeBackend：已规范/缺 ?/缺 /sub/裸域名/尾斜杠/首尾空白", () => {
      expect(normalizeBackend("https://api.dler.io/sub?")).toBe("https://api.dler.io/sub?")
      expect(normalizeBackend("https://api.dler.io/sub")).toBe("https://api.dler.io/sub?")
      expect(normalizeBackend("https://api.dler.io")).toBe("https://api.dler.io/sub?")
      expect(normalizeBackend("https://api.dler.io/")).toBe("https://api.dler.io/sub?")
      expect(normalizeBackend("  https://api.dler.io/sub?  ")).toBe("https://api.dler.io/sub?")
      expect(normalizeBackend("https://x.dev/api")).toBe("https://x.dev/api/sub?")
    }),
    test("normalizeUrlList：换行/竖线/逗号外的混合分割、trim、去空、保序去重", () => {
      expect(normalizeUrlList("a\nb")).toEqual(["a", "b"])
      expect(normalizeUrlList("a|b|c")).toEqual(["a", "b", "c"])
      expect(normalizeUrlList(" a | b\nc\n")).toEqual(["a", "b", "c"])
      expect(normalizeUrlList("a||b\n\n|a")).toEqual(["a", "b"])
      expect(normalizeUrlList("")).toEqual([])
      expect(normalizeUrlList("https://x.dev/s1?token=1|https://y.dev/s2")).toEqual(["https://x.dev/s1?token=1", "https://y.dev/s2"])
    }),
    test("buildConvertUrl：完整参数、固定顺序、url 整体编码", () => {
      const u = buildConvertUrl({
        backend: "https://api.dler.io/sub?",
        target: "clash",
        urls: ["https://a.dev/s1?token=ab", "https://b.dev/s2"],
        config: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini",
        params: { insert: false, emoji: true, udp: true, tfo: false, scv: true, fdn: false, sort: false, expand: false, include: "香港|US", exclude: "过期" },
      })
      expect(u).toBe(
        "https://api.dler.io/sub?target=clash"
        + "&url=" + encodeURIComponent("https://a.dev/s1?token=ab|https://b.dev/s2")
        + "&config=" + encodeURIComponent("https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini")
        + "&insert=false&emoji=true&udp=true&tfo=false&scv=true&fdn=false&sort=false&expand=false"
        + "&include=" + encodeURIComponent("香港|US")
        + "&exclude=" + encodeURIComponent("过期"),
      )
    }),
    test("buildConvertUrl：省略 config/include/exclude、params 缺省用 DEFAULT_PARAMS、backend 自动规范", () => {
      const u = buildConvertUrl({ backend: "https://x.dev", target: "surge&ver=4", urls: ["https://s/1"] })
      expect(u).toBe("https://x.dev/sub?target=surge&ver=4&url=" + encodeURIComponent("https://s/1")
        + "&insert=false&emoji=true&udp=true&tfo=false&scv=false&fdn=false&sort=false&expand=false")
    }),
    test("buildConvertUrl：空 urls / 空 backend / 空 target 抛错", async () => {
      await throws(() => buildConvertUrl({ backend: "https://x.dev", target: "clash", urls: [] }))
      await throws(() => buildConvertUrl({ backend: "   ", target: "clash", urls: ["a"] }))
      await throws(() => buildConvertUrl({ backend: "https://x.dev", target: "", urls: ["a"] }))
      await throws(() => buildConvertUrl({ backend: "https://x.dev", target: "clash", urls: ["  ", ""] }))
    }),
  ])
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()