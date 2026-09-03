// test-traffic.ts — lib/traffic.ts 测试（含 httpbin 联网用例）· run: scripting-ts run <abs>/submon/tests/test-traffic.ts
// FileManager is a runtime global (no import).
import { parseUserInfo, fetchTraffic } from "../lib/traffic"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-traffic.txt"
const lines: string[] = []
const test = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve().then(fn)
    .then(() => lines.push(`PASS: ${name}`))
    .catch((e) => lines.push(`FAIL: ${name} — ${e}`))
const expect = (a: any) => ({
  toBe: (e: any) => { if (a !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
  toEqual: (e: any) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
})

async function run() {
  await Promise.all([
    test("parseUserInfo 标准头", () => {
      expect(parseUserInfo("upload=1024; download=2048; total=10240; expire=1893456000")).toEqual({
        upload: 1024, download: 2048, total: 10240, expire: 1893456000,
      })
    }),
    test("parseUserInfo 缺字段记 0", () => {
      expect(parseUserInfo("total=2048")).toEqual({ upload: 0, download: 0, total: 2048, expire: 0 })
    }),
    test("parseUserInfo 空串全 0", () => {
      expect(parseUserInfo("")).toEqual({ upload: 0, download: 0, total: 0, expire: 0 })
    }),
    test("parseUserInfo 垃圾值跳过", () => {
      expect(parseUserInfo("abc=x; total=NaN; upload=7; ;; expire=100")).toEqual({
        upload: 7, download: 0, total: 0, expire: 100,
      })
    }),
    test("parseUserInfo 逗号分隔也支持", () => {
      expect(parseUserInfo("upload=1,download=2,total=3,expire=4")).toEqual({
        upload: 1, download: 2, total: 3, expire: 4,
      })
    }),
    test("fetchTraffic 联网读取响应头（httpbin）", async () => {
      const url = "https://httpbin.org/response-headers"
        + "?subscription-userinfo=upload%3D1024%3B%20download%3D2048%3B%20total%3D10240%3B%20expire%3D1893456000"
      const info = await fetchTraffic({ url })
      expect(info).toEqual({ upload: 1024, download: 2048, total: 10240, expire: 1893456000 })
    }),
    test("fetchTraffic 无流量头 → 抛可读错误", async () => {
      let msg = ""
      try {
        await fetchTraffic({ url: "https://httpbin.org/get" })
      } catch (e: any) {
        msg = e?.message ?? String(e)
      }
      if (!msg.includes("订阅未返回流量信息")) throw new Error(`expected error 订阅未返回流量信息, got ${msg}`)
    }),
    test("fetchTraffic HTTP 错误 → 抛 HTTP 状态", async () => {
      let msg = ""
      try {
        await fetchTraffic({ url: "https://httpbin.org/status/403" })
      } catch (e: any) {
        msg = e?.message ?? String(e)
      }
      if (!msg.includes("403")) throw new Error(`expected HTTP 403 error, got ${msg}`)
    }),
  ])
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()