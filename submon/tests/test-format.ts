// test-format.ts — lib/format.ts 纯函数测试 · run: scripting-ts run <abs>/submon/tests/test-format.ts
// FileManager is a runtime global (no import).
import {
  formatBytes, formatBytesCompact, daysLeft, isExpired, formatExpireDate, pctUsed, sortByExpiry, relativeTime,
} from "../lib/format"

const OUT = FileManager.appGroupDocumentsDirectory
  + "/scripting-agent/workspace/E7A05671-FB48-474A-A45D-D715324FFF9F/test-results-format.txt"
const lines: string[] = []
const test = (name: string, fn: () => void) =>
  Promise.resolve().then(fn)
    .then(() => lines.push(`PASS: ${name}`))
    .catch((e) => lines.push(`FAIL: ${name} — ${e}`))
const expect = (a: any) => ({
  toBe: (e: any) => { if (a !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
  toEqual: (e: any) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); },
})

const DAY = 86400000

async function run() {
  await Promise.all([
    test("formatBytes 0 → 0 B", () => expect(formatBytes(0)).toBe("0 B")),
    test("formatBytes 1 → 1 B", () => expect(formatBytes(1)).toBe("1 B")),
    test("formatBytes 1023 → 1023 B", () => expect(formatBytes(1023)).toBe("1023 B")),
    test("formatBytes 1024 → 1.0 KB", () => expect(formatBytes(1024)).toBe("1.0 KB")),
    test("formatBytes 1536 → 1.5 KB", () => expect(formatBytes(1536)).toBe("1.5 KB")),
    test("formatBytes 1048576 → 1.0 MB", () => expect(formatBytes(1048576)).toBe("1.0 MB")),
    test("formatBytes 1610612736 → 1.5 GB", () => expect(formatBytes(1610612736)).toBe("1.5 GB")),
    test("formatBytes 1099511627776 → 1.0 TB", () => expect(formatBytes(1099511627776)).toBe("1.0 TB")),
    test("formatBytes 超TB 继续用 TB", () => expect(formatBytes(2048 * 1099511627776)).toBe("2048.0 TB")),

    test("formatBytesCompact 852G", () => expect(formatBytesCompact(852 * 1024 ** 3)).toBe("852GB")),
    test("formatBytesCompact 931G", () => expect(formatBytesCompact(931 * 1024 ** 3)).toBe("931GB")),
    test("formatBytesCompact 1.5G 留1位", () => expect(formatBytesCompact(1.5 * 1024 ** 3)).toBe("1.5GB")),
    test("formatBytesCompact 30G 取整", () => expect(formatBytesCompact(30 * 1024 ** 3)).toBe("30GB")),
    test("formatBytesCompact 512M", () => expect(formatBytesCompact(512 * 1024 ** 2)).toBe("512MB")),
    test("formatBytesCompact 0 → 0 B", () => expect(formatBytesCompact(0)).toBe("0 B")),
    test("formatBytesCompact 1023 B", () => expect(formatBytesCompact(1023)).toBe("1023 B")),

    test("daysLeft 无期限(expire=0) → -1", () => expect(daysLeft(0)).toBe(-1)),
    test("daysLeft 已过期 → 0", () => {
      const now = 2000000000000
      expect(daysLeft((now - 3600000) / 1000, now)).toBe(0)
    }),
    test("daysLeft 恰好3天 → 3", () => {
      const now = 2000000000000
      expect(daysLeft(now / 1000 + 3 * 86400, now)).toBe(3)
    }),
    test("daysLeft 1.5天向上取整 → 2", () => {
      const now = 2000000000000
      expect(daysLeft(now / 1000 + 1.5 * 86400, now)).toBe(2)
    }),

    test("isExpired 无期限 → false", () => expect(isExpired(0)).toBe(false)),
    test("isExpired 已过期 → true", () => expect(isExpired((Date.now() - 60000) / 1000)).toBe(true)),
    test("isExpired 未过期 → false", () => expect(isExpired((Date.now() + 60000) / 1000)).toBe(false)),

    test("formatExpireDate 2030-01-01", () => expect(formatExpireDate(1893456000)).toBe("2030-01-01")),
    test("formatExpireDate 0 → —", () => expect(formatExpireDate(0)).toBe("—")),

    test("pctUsed 常规 25", () => expect(pctUsed(250, 1000)).toBe(25)),
    test("pctUsed total=0 → 0", () => expect(pctUsed(100, 0)).toBe(0)),
    test("pctUsed 超100 clamp", () => expect(pctUsed(1100, 1000)).toBe(100)),
    test("pctUsed 保留1位 33.3", () => expect(pctUsed(333.33, 1000)).toBe(33.3)),

    test("sortByExpiry 无期限排最后且稳定", () => {
      const items = [
        { id: "a", expire: 100 },
        { id: "b", expire: 0 },
        { id: "c", expire: 50 },
        { id: "d", expire: 0 },
        { id: "e", expire: 200 },
      ]
      expect(sortByExpiry(items, (t) => t.expire).map((t) => t.id)).toEqual(["c", "a", "e", "b", "d"])
    }),
    test("sortByExpiry 原数组不被修改", () => {
      const items = [{ id: "a", expire: 100 }, { id: "b", expire: 50 }]
      sortByExpiry(items, (t) => t.expire)
      expect(items.map((t) => t.id)).toEqual(["a", "b"])
    }),

    test("relativeTime 刚刚", () => {
      const now = 2000000000000
      expect(relativeTime(now - 30000, now)).toBe("刚刚")
    }),
    test("relativeTime 90s → 1 分钟前", () => {
      const now = 2000000000000
      expect(relativeTime(now - 90000, now)).toBe("1 分钟前")
    }),
    test("relativeTime 2小时前", () => {
      const now = 2000000000000
      expect(relativeTime(now - 2 * 3600000, now)).toBe("2 小时前")
    }),
    test("relativeTime 3天前", () => {
      const now = 2000000000000
      expect(relativeTime(now - 3 * DAY, now)).toBe("3 天前")
    }),
    test("relativeTime 未来时间 → 刚刚", () => {
      const now = 2000000000000
      expect(relativeTime(now + 3600000, now)).toBe("刚刚")
    }),
  ])
  const fails = lines.filter((l) => l.startsWith("FAIL")).length
  lines.push(`--- ${lines.length - fails}/${lines.length} passed ---`)
  FileManager.writeAsStringSync(OUT, lines.join("\n"))
}

run()