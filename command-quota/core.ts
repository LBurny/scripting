// core.ts — command-quota 共享逻辑：存储 / 解析 / 格式化 / fetch（无 UI）
// 数据来源：Command Code 的 alpha 接口（Bearer 认证，与 CLI 的 /usage 同源）
//   GET /alpha/whoami?limits=1        → user / org
//   GET /alpha/billing/subscriptions  → planId / 计费周期
//   GET /alpha/billing/credits        → 剩余额度 + 5小时/周 两个滚动窗口
//   GET /alpha/usage/summary?since=…  → 本周期请求数 / token / 花费
const KEY_LIST = "command_keys"

export interface Account { key: string; name: string }

export function loadAccounts(): Account[] {
  const raw = Storage.get<string>(KEY_LIST)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((a: any) => a && typeof a === "object" && typeof a.key === "string" && a.key)
      .map((a: any, i: number) => ({ key: String(a.key), name: String(a.name || `Key ${i + 1}`) }))
  } catch {
    return []
  }
}

export function saveAccounts(list: Account[]): void {
  Storage.set(KEY_LIST, JSON.stringify(list))
}

// ---- 套餐（额度数值与 CLI getPlanInfo 一致）----
const PLAN_CREDITS: Record<string, number> = {
  "individual-go": 10,
  "individual-goat": 70,
  "individual-pro": 30,
  "individual-pro-v1": 80,
  "individual-provider": 15,
  "individual-max": 150,
  "individual-ultra": 300,
  "teams-pro": 40,
}
const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-provider": "Provider",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
  "teams-pro": "Teams Pro",
}
const PLAN_KEYS = Object.keys(PLAN_CREDITS).sort((a, b) => b.length - a.length)

export interface PlanInfo { id: string; name: string; monthlyCredits: number }

export function planInfo(planId: string | null | undefined): PlanInfo | null {
  if (!planId) return null
  const t = String(planId).toLowerCase().replace(/_/g, "-")
  const hit = PLAN_KEYS.find(k => t.startsWith(k))
  if (!hit) return null
  return { id: hit, name: PLAN_NAMES[hit], monthlyCredits: PLAN_CREDITS[hit] }
}

// ---- 用量解析 ----
/** 滚动窗口：used / cap 以「额度值($)」计，pct 为已用百分比 */
export interface Win {
  used: number
  cap: number
  remain: number
  pct: number
  resetAt: number | null
  exceeded: boolean
}

export function winRemain(w: Win | null): number | null {
  return w ? Math.max(0, 100 - w.pct) : null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** resetAt 可能是秒或毫秒时间戳，统一成毫秒 */
function toMs(v: any): number | null {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return null
  return n < 1e11 ? n * 1000 : n
}

function num(v: any, dflt = 0): number {
  const n = Number(v)
  return isFinite(n) ? n : dflt
}

function parseWin(w: any): Win | null {
  if (!w || typeof w !== "object") return null
  const used = num(w.used, NaN)
  const cap = num(w.cap, NaN)
  if (!isFinite(used) || !isFinite(cap) || cap <= 0) return null
  const pct = round1(Math.max(0, Math.min(100, (used / cap) * 100)))
  return {
    used,
    cap,
    remain: Math.max(0, cap - used),
    pct,
    resetAt: toMs(w.resetAt),
    exceeded: !!w.exceeded,
  }
}

export interface Usage {
  five: Win | null
  weekly: Win | null
  planId: string
  plan: string
  planMonthly: number | null
  status: string
  periodEnd: number | null
  monthlyRemaining: number
  extraRemaining: number
  totalRemaining: number
  totalSpent: number
  totalPool: number
  usagePct: number
  requests: number
  tokens: number
  tokensIn: number
  tokensOut: number
  userName: string
  orgName: string
  /** 已知组织（null = 无组织）——带上它就能跳过 whoami，把请求压进一轮 */
  orgId: string | null
  /** 当前计费周期起点字符串（summary 的 since） */
  periodStart: string | null
  /** 本周期汇总（请求/token/花费）是否取到 */
  summaryOk: boolean
  error: string
}

function emptyUsage(error: string): Usage {
  return {
    five: null, weekly: null,
    planId: "", plan: "", planMonthly: null, status: "", periodEnd: null,
    monthlyRemaining: 0, extraRemaining: 0, totalRemaining: 0,
    totalSpent: 0, totalPool: 0, usagePct: 0,
    requests: 0, tokens: 0, tokensIn: 0, tokensOut: 0,
    userName: "", orgName: "", orgId: null, periodStart: null, summaryOk: false, error,
  }
}

export function parseQuota(whoami: any, credits: any, subs: any, summary: any): Usage {
  const out = emptyUsage("")
  const user = whoami?.user
  if (user) out.userName = String(user.userName || user.name || "")
  out.orgName = whoami?.org ? String(whoami.org.login || whoami.org.name || "") : ""

  const sub = subs?.data ?? null
  if (sub) {
    out.status = String(sub.status || "")
    out.planId = String(sub.planId || "")
    const end = Date.parse(String(sub.currentPeriodEnd || ""))
    if (isFinite(end)) out.periodEnd = end
  }
  if (!out.planId && credits?.credits?.planId) out.planId = String(credits.credits.planId)
  const pi = planInfo(out.planId)
  if (pi) { out.plan = pi.name; out.planMonthly = pi.monthlyCredits }

  const cr = credits?.credits ?? null
  if (cr) {
    out.monthlyRemaining = Math.max(0, num(cr.monthlyCredits))
    out.extraRemaining = Math.max(0, num(cr.purchasedCredits) + num(cr.freeCredits))
  }
  const wl = credits?.windowLimits ?? null
  if (wl) {
    out.five = parseWin(wl.fiveHour)
    out.weekly = parseWin(wl.weekly)
  }
  if (summary && typeof summary === "object") {
    out.requests = num(summary.totalCount)
    out.tokens = num(summary.totalTokens)
    out.tokensIn = num(summary.totalTokensIn)
    out.tokensOut = num(summary.totalTokensOut)
    out.totalSpent = num(summary.totalCost)
  }

  // 总剩余 = 订阅月额度剩余 + 额外(购买/赠送)剩余（额外额度不受窗口限制）
  out.totalRemaining = out.monthlyRemaining + out.extraRemaining
  // 额度池：活跃订阅时至少为套餐月额度；否则用 已花费 + 剩余
  const active = out.status === "active" && out.planMonthly != null
  out.totalPool = active
    ? Math.max(out.planMonthly as number, out.monthlyRemaining) + out.extraRemaining
    : out.totalSpent + out.totalRemaining
  out.usagePct = out.totalPool > 0 ? round1(Math.max(0, Math.min(100, ((out.totalPool - out.totalRemaining) / out.totalPool) * 100))) : 0

  // 缓存提示用：已知组织 / 当前计费周期起点 / 汇总是否到手
  out.orgId = whoami?.org?.id ? String(whoami.org.id) : null
  out.periodStart = sub?.currentPeriodStart ? String(sub.currentPeriodStart) : null
  out.summaryOk = !!summary && typeof summary === "object"

  if (!out.five && !out.weekly && !cr) out.error = "未解析到用量数据"
  return out
}

// ---- 时间工具 ----
export function countdown(fromMs: number, toMs: number): string {
  const diff = toMs - fromMs
  if (diff <= 0) return "已重置"
  const days = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `${days}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}

export function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

/** 绝对时间 HH:MM（跨天时附 M/D） */
export function clockText(ts: number | null, nowMs = Date.now()): string {
  if (!ts) return ""
  const d = new Date(ts)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const same = new Date(nowMs).toDateString() === d.toDateString()
  return same ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 相对时间：刚刚 / 12分钟前 / 3小时前 / 2天前（组件用它标注缓存数据有多旧） */
export function agoText(ts: number, nowMs = Date.now()): string {
  const min = Math.floor(Math.max(0, nowMs - ts) / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min}分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}

/** 「3小时12分 后重置 (15:23)」 */
export function resetText(w: Win | null, nowMs = Date.now()): string {
  if (!w || !w.resetAt) return ""
  const cd = countdown(nowMs, w.resetAt)
  const at = clockText(w.resetAt, nowMs)
  return cd === "已重置" ? "已重置" : `${cd} 后重置 · ${at}`
}

/** 短版：「3小时12分 后重置」（App 页用，与 ollama 一致只留相对倒计时） */
export function resetShort(w: Win | null, nowMs = Date.now()): string {
  if (!w || !w.resetAt) return ""
  const cd = countdown(nowMs, w.resetAt)
  return cd === "已重置" ? "已重置" : `${cd} 后重置`
}

export function daysLeft(ts: number | null, nowMs = Date.now()): number | null {
  if (!ts) return null
  return Math.max(0, Math.ceil((ts - nowMs) / 86400000))
}

// ---- 颜色与格式化 ----
export function remColor(usedPct: number): string {
  const rem = 100 - usedPct
  if (rem >= 50) return "systemGreen"
  if (rem >= 30) return "systemYellow"
  if (rem >= 15) return "systemOrange"
  return "systemRed"
}

export function remRGB(usedPct: number): [string, string] {
  const rem = 100 - usedPct
  if (rem >= 50) return ["rgba(48,209,88,1)", "rgba(48,209,88,0.45)"]
  if (rem >= 30) return ["rgba(255,214,10,1)", "rgba(255,214,10,0.45)"]
  if (rem >= 15) return ["rgba(255,159,10,1)", "rgba(255,159,10,0.45)"]
  return ["rgba(255,69,58,1)", "rgba(255,69,58,0.45)"]
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—"
  const n = typeof v === "number" ? v : parseFloat(v)
  if (!isFinite(n)) return "—"
  if (n % 1 === 0) return `$${n}`
  return `$${n.toFixed(2)}`
}

export function fmtTokens(v: number): string {
  if (!isFinite(v) || v <= 0) return "0"
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

export function maskKey(k: string): string {
  return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k
}

// ---- 超时包装：小组件刷新时间预算有限，慢请求必须有兜底 ----
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))])
}

// ---- 网络请求 ----
const BASE = "https://api.commandcode.ai"

export function apiError(status: number): string {
  if (status === 401) return "Key 无效或已过期(401)"
  if (status === 403) return "无权限访问(403)"
  if (status === 429) return "请求过于频繁(429)，请稍后重试"
  if (status === 404) return "接口不存在(404)，可能已变更"
  return `接口错误 HTTP ${status}`
}

async function getJson(key: string, path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" } })
  if (!r.ok) throw new Error(apiError(r.status))
  let body: any = null
  try { body = await r.json() } catch { body = null }
  if (body && body.success === false) throw new Error(String(body.message || "接口返回失败"))
  return body
}

export interface Whoami { userName: string; orgId: string | null; orgName: string }

export async function fetchWhoami(key: string): Promise<Whoami> {
  const b = await getJson(key, "/alpha/whoami?limits=1")
  return {
    userName: String(b?.user?.userName || b?.user?.name || ""),
    orgId: b?.org?.id ? String(b.org.id) : null,
    orgName: b?.org ? String(b.org.login || b.org.name || "") : "",
  }
}

/** 组织查询串（纯函数，便于测试） */
export function orgQuery(orgId: string | null | undefined): string {
  return orgId ? `orgId=${encodeURIComponent(orgId)}` : ""
}

/** since = 当前计费周期起点，summary 用它统计「本周期」 */
export function sinceQuery(since: string | null | undefined): string {
  return since ? `since=${encodeURIComponent(since)}` : ""
}

export function queryString(...parts: string[]): string {
  const q = parts.filter(p => !!p).join("&")
  return q ? `?${q}` : ""
}

export interface FetchHint {
  /** undefined = 未知（老缓存，需走完整路径）；null = 已知无组织 */
  orgId?: string | null
  periodStart?: string | null
  userName?: string
  orgName?: string
}

export interface FetchOptions {
  hint?: FetchHint | null
  /** 首轮没拿到本周期汇总时是否再补一轮（App 页可，小组件预算内传 false） */
  followUpSummary?: boolean
}

/** 单请求结果：不抛错，让一轮并行里的各请求独立成败 */
interface Settled<T> { ok: boolean; v: T | null; error: string }

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, v: await p, error: "" }
  } catch (e: any) {
    return { ok: false, v: null, error: String(e?.message || e || "请求失败") }
  }
}

function okSettled<T>(v: T | null): Settled<T> { return { ok: true, v, error: "" } }

/** 网络/接口错误统一文案（apiError 已自带括号，原样透出） */
function asError(msg: string): string {
  return msg.startsWith("接口") || msg.includes("(") ? msg : `网络请求失败：${msg}`
}

/**
 * 拉取完整额度信息。
 * 带 orgId 提示时跳过 whoami，把 credits / subs / summary 放进**同一轮并行**：
 * 这几个接口单次就要 2.4–5.1s，只有压成一轮才可能落在小组件的几秒预算内
 * （原来的 whoami → subs/credits → summary 串行三段实测 8–20s，组件必然超时回退旧缓存）。
 */
export async function fetchQuota(key: string, opts: FetchOptions = {}): Promise<Usage> {
  const hint = opts.hint ?? null
  const followUp = opts.followUpSummary !== false
  const knownOrg = !!hint && hint.orgId !== undefined
  try {
    let orgId: string | null = knownOrg ? hint!.orgId ?? null : null
    const sinceHint: string | null = knownOrg ? hint!.periodStart ?? null : null

    const round = (withSummary: boolean) => Promise.all([
      knownOrg ? Promise.resolve(okSettled<Whoami>(null)) : settle(fetchWhoami(key)),
      settle(getJson(key, `/alpha/billing/credits${queryString(orgQuery(orgId))}`)),
      settle(getJson(key, `/alpha/billing/subscriptions${queryString(orgQuery(orgId))}`)),
      withSummary && sinceHint
        ? settle(getJson(key, `/alpha/usage/summary${queryString(orgQuery(orgId), sinceQuery(sinceHint))}`))
        : Promise.resolve(okSettled<any>(null)),
    ])

    let [who, cr, sb, sm] = await round(true)
    let summaryOk = !!sm.v

    // 无提示时首轮并不知道组织：账号属于某组织时首轮作用域不对，需按 orgId 重取
    if (!knownOrg) {
      if (!who.ok || !who.v) throw new Error(who.error || "whoami 请求失败")
      orgId = who.v.orgId
      if (orgId) {
        const again = await Promise.all([
          settle(getJson(key, `/alpha/billing/credits${queryString(orgQuery(orgId))}`)),
          settle(getJson(key, `/alpha/billing/subscriptions${queryString(orgQuery(orgId))}`)),
        ])
        cr = again[0]
        sb = again[1]
      }
    }

    const subSince = sb.v?.data?.currentPeriodStart ? String(sb.v.data.currentPeriodStart) : null
    // 提示里的周期已过（换月）：本轮汇总统计的是旧周期，作废以免显示上一周期数字
    if (summaryOk && sinceHint && subSince && sinceHint !== subSince) {
      sm = okSettled<any>(null)
      summaryOk = false
    }

    if (!summaryOk && followUp && subSince) {
      const r = await settle(getJson(key, `/alpha/usage/summary${queryString(orgQuery(orgId), sinceQuery(subSince))}`))
      if (r.ok && r.v) { sm = r; summaryOk = true }
    }

    if (!cr.ok || !cr.v) throw new Error(cr.error || "额度接口未返回数据")

    const u = parseQuota(who.v, cr.v, sb.v, sm.v)
    u.orgId = orgId
    u.periodStart = subSince
    u.summaryOk = summaryOk
    u.userName = knownOrg ? hint!.userName ?? "" : who.v?.userName ?? ""
    u.orgName = knownOrg ? hint!.orgName ?? "" : orgId ? who.v?.orgName ?? "" : ""
    return u
  } catch (e: any) {
    return emptyUsage(asError(String(e?.message || e || "未知错误")))
  }
}

// ---- 小组件成功数据缓存：网络失败/超时时回退显示，避免整棵不渲染 ----
const KEY_CACHE = "command_widget_cache"

export interface CachedState {
  name: string
  plan: string
  five: Win | null
  weekly: Win | null
  totalRemaining: number
  monthlyRemaining: number
  extraRemaining: number
  usagePct: number
  requests: number
  tokens: number
  totalSpent: number
  /** 取数时刻（ms）：只在真正取到新数据时前移，回退显示时界面靠它标注「缓存 X 前」 */
  ts: number
  /** 已知组织（null = 无组织）；老缓存无此字段 → undefined，下轮走完整路径补齐 */
  orgId?: string | null
  /** 当前计费周期起点（summary 的 since 提示） */
  periodStart?: string | null
  userName?: string
  orgName?: string
}

export function loadWidgetCache(): CachedState[] {
  const raw = Storage.get<string>(KEY_CACHE)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s: any) => s && typeof s === "object") : []
  } catch {
    return []
  }
}

export function saveWidgetCache(states: CachedState[]): void {
  try { Storage.set(KEY_CACHE, JSON.stringify(states)) } catch {}
}

/** 账号对应的缓存条目：先按位置匹配（账号顺序一般不变），再按名字兜底 */
export function cacheFor(cache: CachedState[], name: string, i: number): CachedState | null {
  const byIdx = cache[i]
  if (byIdx && byIdx.name === name) return byIdx
  return cache.find(c => c.name === name) ?? null
}

/** 可用快照：必须有取数时刻（ts=0 是占位空条目） */
export function usableCache(c: CachedState | null | undefined): CachedState | null {
  return c && c.ts ? c : null
}

/** 空占位条目：保持数组位置稳定（usableCache 会忽略 ts=0 的条目） */
export function emptyCached(name: string): CachedState {
  return {
    name, plan: "", five: null, weekly: null, totalRemaining: 0, monthlyRemaining: 0,
    extraRemaining: 0, usagePct: 0, requests: 0, tokens: 0, totalSpent: 0, ts: 0,
  }
}

/** 缓存里的查询提示；老缓存无 orgId → null（走完整路径，拿到后即补齐） */
export function hintOf(c: CachedState | null | undefined): FetchHint | null {
  if (!c || c.orgId === undefined) return null
  return { orgId: c.orgId ?? null, periodStart: c.periodStart ?? null, userName: c.userName, orgName: c.orgName }
}

/** 取到新数据后写缓存；本轮没拿到本周期汇总时沿用旧数字，避免把 0 写进去 */
export function toCached(name: string, u: Usage, prev?: CachedState | null, now = Date.now()): CachedState {
  const keep = !u.summaryOk && !!prev
  const p = prev ?? null
  return {
    name, plan: u.plan || p?.plan || "", five: u.five, weekly: u.weekly,
    totalRemaining: u.totalRemaining, monthlyRemaining: u.monthlyRemaining,
    extraRemaining: u.extraRemaining, usagePct: u.usagePct,
    requests: keep && p ? p.requests : u.requests,
    tokens: keep && p ? p.tokens : u.tokens,
    totalSpent: keep && p ? p.totalSpent : u.totalSpent,
    orgId: u.orgId, periodStart: u.periodStart, userName: u.userName, orgName: u.orgName,
    ts: now,
  }
}

/** 与快照相比展示数据是否有变化（决定要不要通知系统重绘组件） */
export function cacheDiffers(c: CachedState | null | undefined, u: Usage): boolean {
  if (u.error) return false
  if (!c || !c.ts) return true
  return c.requests !== u.requests || c.totalSpent !== u.totalSpent || c.totalRemaining !== u.totalRemaining
    || (c.five ? c.five.pct : null) !== (u.five ? u.five.pct : null)
    || (c.weekly ? c.weekly.pct : null) !== (u.weekly ? u.weekly.pct : null)
}

// ---- 组件状态：由 Usage / 缓存快照构造，并标注数据新鲜度 ----
export interface WidgetState {
  name: string
  plan: string
  five: Win | null
  weekly: Win | null
  totalRemaining: number
  monthlyRemaining: number
  extraRemaining: number
  usagePct: number
  requests: number
  tokens: number
  totalSpent: number
  error: string
  /** 整卡数据来自缓存快照（本轮没取到） */
  stale: boolean
  /** 本周期汇总可用（否则显示「本周期数据暂不可用」而不是 0） */
  summaryOk: boolean
  /** 显示数据的取数时刻（ms）：新鲜 = 本次，缓存 = 快照时刻 */
  dataAt: number
}

/** 本轮取到数据：直接展示 */
export function fromUsageState(name: string, u: Usage, now = Date.now()): WidgetState {
  return {
    name, plan: u.plan, five: u.five, weekly: u.weekly,
    totalRemaining: u.totalRemaining, monthlyRemaining: u.monthlyRemaining,
    extraRemaining: u.extraRemaining, usagePct: u.usagePct,
    requests: u.requests, tokens: u.tokens, totalSpent: u.totalSpent,
    error: u.error, stale: false, summaryOk: u.summaryOk, dataAt: now,
  }
}

/** 回退显示上次成功快照：带上快照时刻，界面据此标注「缓存 X 前」 */
export function fromCachedState(c: CachedState): WidgetState {
  return {
    name: c.name, plan: c.plan, five: c.five, weekly: c.weekly,
    totalRemaining: c.totalRemaining, monthlyRemaining: c.monthlyRemaining,
    extraRemaining: c.extraRemaining, usagePct: c.usagePct,
    requests: c.requests, tokens: c.tokens, totalSpent: c.totalSpent,
    error: "", stale: true, summaryOk: true, dataAt: c.ts,
  }
}
