// lib/format.ts — 纯函数：字节/日期/进度格式化与排序（无 IO，可 TDD）

/** 字节格式化：1024 进制，B/KB/MB/GB/TB，≥1024 保留 1 位小数，超 TB 继续以 TB 计 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return i === 0 ? `${v} B` : `${(Math.round(v * 10) / 10).toFixed(1)} ${units[i]}`
}

/** 字节紧凑格式化（小组件/窄场景）：B 全量，KB 起 <10 留 1 位小数、≥10 取整，如 852G / 1.5G */
export function formatBytesCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  if (i === 0) return `${v} B`
  const s = v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1)
  return `${s}${units[i]}`
}

/** 剩余天数：expire≤0（无期限）→ −1；已过期 → 0；否则 ceil(到期差) */
export function daysLeft(expireSec: number, now: number = Date.now()): number {
  if (expireSec <= 0) return -1
  return Math.max(0, Math.ceil((expireSec * 1000 - now) / 86400000))
}

/** 是否已过期（无期限视为永不过期） */
export function isExpired(expireSec: number, now: number = Date.now()): boolean {
  if (expireSec <= 0) return false
  return expireSec * 1000 <= now
}

/** 到期日期 yyyy-MM-dd（本地时区）；0 → "—" */
export function formatExpireDate(expireSec: number): string {
  if (expireSec <= 0) return "—"
  const d = new Date(expireSec * 1000)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 已用百分比（0–100，保留 1 位）；total≤0 → 0 */
export function pctUsed(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 1000) / 10)
}

/** 按到期时间排序：>0 升序在前，≤0（无期限）排最后且保持相对稳定；不修改原数组 */
export function sortByExpiry<T>(items: T[], getExpire: (t: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ea = getExpire(a.item)
      const eb = getExpire(b.item)
      const na = ea > 0 ? 0 : 1
      const nb = eb > 0 ? 0 : 1
      if (na !== nb) return na - nb
      if (na === 0 && ea !== eb) return ea - eb
      return a.index - b.index
    })
    .map((x) => x.item)
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；未来时间视为刚刚 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}