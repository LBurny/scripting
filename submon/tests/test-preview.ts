// test-preview.ts — lib/preview.ts 纯函数测试（无网络）· run: scripting-ts run "<abs>/submon/tests/test-preview.ts"
// FileManager is a runtime global (no import).
import { parseSurgeConfig, buildPreviewUrl, fetchPreviewWithFallback } from "../lib/preview"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-preview.txt"
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
  toBe: (e: any) => { if (a !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`) },
  toEqual: (e: any) => { if (!deepEq(a, e)) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`) },
})

const FIXTURE = [
  "#!MANAGED-CONFIG https://api.dler.io/sub interval=86400 strict=false",
  "",
  "[General]",
  "loglevel = notify",
  "dns-server = 223.5.5.5",
  "",
  "[Proxy]",
  "DIRECT = direct",
  "🇭🇰 香港 01 = ss, 1.2.3.4, 443, encrypt-method=aes-128-gcm, password=pw, udp-relay=true",
  "🇯🇵 日本 02 = vmess, 5.6.7.8, 80, username=uuid",
  "",
  "[Proxy Group]",
  "🚀 节点选择 = select, 🇭🇰 香港 01, 🇯🇵 日本 02, DIRECT",
  "♻️ 自动选择 = url-test, 🇭🇰 香港 01, 🇯🇵 日本 02, url=http://www.gstatic.com/generate_204, interval=600",
  "🐟 漏网之鱼 = select, 🚀 节点选择, DIRECT",
  "🈳 空组 = select",
  "",
  "[Rule]",
  "DOMAIN-SUFFIX,google.com,🚀 节点选择",
  "# 注释行",
  "; 另一种注释",
  "MATCH,🐟 漏网之鱼",
  "",
].join("\n")

async function run() {
  await Promise.all([
    test("parseSurgeConfig：解析 [Proxy] 节点名（跳过其他段/注释/空行）", () => {
      const r = parseSurgeConfig(FIXTURE)
      expect(r.proxies).toEqual(["🇭🇰 香港 01", "🇯🇵 日本 02"])
    }),
    test("parseSurgeConfig：解析 [Proxy Group] 组名/类型/成员，丢弃 key=value 参数段", () => {
      const r = parseSurgeConfig(FIXTURE)
      expect(r.groups).toEqual([
        { name: "🚀 节点选择", type: "select", members: ["🇭🇰 香港 01", "🇯🇵 日本 02", "DIRECT"] },
        { name: "♻️ 自动选择", type: "url-test", members: ["🇭🇰 香港 01", "🇯🇵 日本 02"] },
        { name: "🐟 漏网之鱼", type: "select", members: ["🚀 节点选择", "DIRECT"] },
        { name: "🈳 空组", type: "select", members: [] },
      ])
    }),
    test("parseSurgeConfig：空文本/无相关段 → 空结果", () => {
      expect(parseSurgeConfig("")).toEqual({ groups: [], proxies: [] })
      expect(parseSurgeConfig("[General]\nloglevel = notify\n")).toEqual({ groups: [], proxies: [] })
    }),
    test("parseSurgeConfig：[Proxy] 中 DIRECT/REJECT 内建行被过滤", () => {
      const r = parseSurgeConfig(FIXTURE)
      expect(r.proxies.indexOf("DIRECT") >= 0).toBe(false)
      const r2 = parseSurgeConfig("[Proxy]\nREJECT = reject\nREJECT-DROP = reject-drop\nA = ss, h, 1\n")
      expect(r2.proxies).toEqual(["A"])
    }),
    test("parseSurgeConfig：CRLF 换行兼容", () => {
      const r = parseSurgeConfig("[Proxy]\r\nA = ss, h, 1\r\n[Proxy Group]\r\nG = select, A\r\n")
      expect(r.proxies).toEqual(["A"])
      expect(r.groups).toEqual([{ name: "G", type: "select", members: ["A"] }])
    }),
    test("buildPreviewUrl：强制 surge&ver=4，保留 config 与布尔参数", () => {
      const u = buildPreviewUrl({
        backend: "https://api.dler.io/sub?",
        urls: ["https://a.com/s1", "https://b.com/s2"],
        config: "https://cfg.com/x.ini",
        params: { emoji: true, udp: true, include: "香港" },
      })
      expect(u.startsWith("https://api.dler.io/sub?")).toBe(true)
      expect(u.indexOf("target=surge&ver=4") >= 0).toBe(true)
      expect(u.indexOf("url=" + encodeURIComponent("https://a.com/s1|https://b.com/s2")) >= 0).toBe(true)
      expect(u.indexOf("config=" + encodeURIComponent("https://cfg.com/x.ini")) >= 0).toBe(true)
      expect(u.indexOf("emoji=true") >= 0).toBe(true)
      expect(u.indexOf("tfo=false") >= 0).toBe(true)
      expect(u.indexOf("include=" + encodeURIComponent("香港")) >= 0).toBe(true)
      expect(u.indexOf("exclude=") >= 0).toBe(false)
    }),
    test("fallback：首选快速成功则备选不发起（错峰竞速）", async () => {
      const calls: string[] = []
      const fetcher = async (opts: any) => { calls.push(opts.backend); return { groups: [], proxies: [] } }
      const r = await fetchPreviewWithFallback(
        { backend: "https://a/sub?", backends: ["https://a/sub?", "https://a/sub?", "https://b/sub?"], urls: ["u"] },
        1000,
        fetcher as any,
        20,
      )
      expect(r.usedBackend).toBe("https://a/sub?")
      expect(calls).toEqual(["https://a/sub?"])
      expect(r.selectedError).toBe("")
    }),
    test("fallback：首选失败自动切换并记录 selectedError", async () => {
      const calls: string[] = []
      const fetcher = async (opts: any) => {
        calls.push(opts.backend)
        if (opts.backend === "https://a/sub?") throw new Error("HTTP 502")
        return { groups: [], proxies: ["N1"] }
      }
      const r = await fetchPreviewWithFallback(
        { backend: "https://a/sub?", backends: ["https://a/sub?", "https://b/sub?"], urls: ["u"] },
        1000,
        fetcher as any,
        20,
      )
      expect(r.usedBackend).toBe("https://b/sub?")
      expect(r.result.proxies).toEqual(["N1"])
      expect(r.errors.length).toBe(1)
      expect(r.selectedError).toBe("HTTP 502")
      // 错峰：首选 a 必须先发起
      expect(calls[0]).toBe("https://a/sub?")
    }),
    test("fallback：首选慢备选快 → 用备选结果且 selectedError 为空", async () => {
      const fetcher = (opts: any) => new Promise<any>((resolve) => {
        if (opts.backend === "https://a/sub?") setTimeout(() => resolve({ groups: [], proxies: ["SLOW"] }), 200)
        else resolve({ groups: [], proxies: ["FAST"] })
      })
      const r = await fetchPreviewWithFallback(
        { backend: "https://a/sub?", backends: ["https://b/sub?"], urls: ["u"] },
        1000,
        fetcher as any,
        20,
      )
      expect(r.usedBackend).toBe("https://b/sub?")
      expect(r.result.proxies).toEqual(["FAST"])
      expect(r.selectedError).toBe("")
    }),
    test("fallback：全部失败抛汇总错误（含各后端原因）", async () => {
      const fetcher = async (opts: any) => { throw new Error("boom " + opts.backend) }
      let msg = ""
      try {
        await fetchPreviewWithFallback(
          { backend: "https://a/sub?", backends: ["https://b/sub?"], urls: ["u"] },
          1000,
          fetcher as any,
          20,
        )
      } catch (e: any) { msg = e?.message ?? String(e) }
      expect(msg.indexOf("所有后端均失败") >= 0).toBe(true)
      expect(msg.indexOf("boom https://a/sub?") >= 0).toBe(true)
      expect(msg.indexOf("boom https://b/sub?") >= 0).toBe(true)
    }),
  ])
  const summary = `== ${lines.filter((l) => l.startsWith("PASS")).length}/${lines.length} PASS ==`
  try { FileManager.writeAsStringSync(OUT, summary + "\n" + lines.join("\n") + "\n") } catch { }
}

run()
