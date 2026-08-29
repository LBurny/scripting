// Surge HTTP API 封装（端点文档：https://manual.nssurge.com/others/http-api.html）
import { fetch } from "scripting"
import { parsePrometheus, uptimeSecondsFromStartTime, type MetricSample } from "./metrics"

export type SurgeConfig = {
  protocol: "http" | "https"
  host: string
  port: string
  key: string
}

export const DEFAULT_CONFIG: SurgeConfig = {
  // Surge 默认 http-api-tls = false；HTTPS 用 MITM 自签证书，请求需跳过系统链校验
  protocol: "http",
  host: "127.0.0.1",
  port: "6166",
  key: "",
}

/** Surge HTTP API 的 TLS 证书由 MITM CA 签发，系统链校验会失败；鉴权靠 X-Key */
function allowInsecure(_c: SurgeConfig): boolean {
  return true
}

function httpStatusError(status: number): Error {
  if (status === 401) return new Error("Key 无效")
  return new Error(`HTTP ${status}`)
}

function wrapFetchError(e: unknown): Error {
  const s = String(e)
  if (/TLS|TlsHandler|证书|certificate/i.test(s)) {
    return new Error(
      `${s}。Surge HTTPS API 使用 MITM 自签证书。可改用 http（默认 http-api-tls = false），或确认 Scripting 已允许本地网络。`
    )
  }
  if (/401|unauthorized/i.test(s)) {
    return new Error("Key 无效")
  }
  if (/timeout|timed?\s*out|ETIMEDOUT|超时/i.test(s)) {
    return new Error("连接超时。请确认 HTTP API 已开启，并允许 Scripting 访问本地网络")
  }
  return e instanceof Error ? e : new Error(s)
}

function urlOf(c: SurgeConfig, path: string): string {
  const port = c.port.trim()
  const portPart = port ? `:${port}` : ""
  return `${c.protocol}://${c.host.trim()}${portPart}${path}`
}

async function request<T>(
  c: SurgeConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(urlOf(c, path), {
    method,
    headers: {
      "X-Key": c.key,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeout: 30,
    allowInsecureRequest: allowInsecure(c),
    debugLabel: `surge-panel ${method} ${path}`,
  }).catch((e) => {
    throw wrapFetchError(e)
  })
  if (!res.ok) {
    throw httpStatusError(res.status)
  }
  const text = await res.text()
  if (!text || text === "OK") return undefined as T
  return JSON.parse(text) as T
}

function get<T>(c: SurgeConfig, path: string): Promise<T> {
  return request<T>(c, "GET", path)
}
function post<T>(c: SurgeConfig, path: string, body?: unknown): Promise<T> {
  return request<T>(c, "POST", path, body)
}

// ---------- Metrics ----------

/** iOS 5.22+ / Mac 6.9+；商店版与 Mac 6.8 返回 404。没有端点时返回 null，不视为连接失败。 */
export async function fetchMetrics(c: SurgeConfig): Promise<MetricSample[] | null> {
  const res = await fetch(urlOf(c, "/v1/metrics"), {
    headers: { "X-Key": c.key },
    timeout: 15,
    allowInsecureRequest: allowInsecure(c),
    debugLabel: "surge-panel metrics",
  }).catch((e) => {
    throw wrapFetchError(e)
  })
  if (res.status === 404 || res.status === 405 || res.status === 501) return null
  if (!res.ok) throw httpStatusError(res.status)
  const text = (await res.text()).trim()
  if (!text || text.startsWith("{") || text.startsWith("[")) return null
  const samples = parsePrometheus(text)
  return samples.length > 0 ? samples : null
}

// ---------- 类型 ----------

export type PolicyOption = {
  isGroup: boolean
  name: string
  typeDescription: string
  lineHash: string
  enabled: boolean
}

export type PolicyTestResult = Record<
  string,
  { tfo?: boolean; tcp?: number; receive?: number; available?: number; "round-one-total"?: number }
>

export type GroupTestResult = Record<
  string,
  (string | { policy: string; score?: number; "available-total"?: number })[]
>

export type TimingRecord = {
  name: string
  durationInMillisecond: number
}

export type SurgeRequest = {
  id: number
  URL: string
  method?: string
  policyName: string
  originalPolicyName?: string
  rule?: string
  inCurrentSpeed?: number
  outCurrentSpeed?: number
  inMaxSpeed?: number
  outMaxSpeed?: number
  inBytes?: number
  outBytes?: number
  startDate?: number
  completedDate?: number
  completed?: boolean
  failed?: boolean
  rejected?: boolean
  status?: string
  deviceName?: string
  remoteHost?: string
  remoteAddress?: string
  localAddress?: string
  sourceAddress?: string
  sourcePort?: number
  interface?: string
  takeoverMode?: string
  notes?: string[]
  source?: string
  timingRecords?: TimingRecord[]
}

export type SurgeEvent = {
  identifier: string
  /** ISO 日期字符串，如 "2026-08-13T14:00:00+0800" */
  date: string
  /** -1 / 0 / 1 等级 */
  type: number
  allowDismiss?: boolean
  content?: string
}

export type DnsEntry = {
  domain: string
  server?: string | null
  interface?: string
  data?: string | string[] | null
  logs?: string[]
  path?: string
  timeCost?: number
  expiresTime?: number
  comment?: string | null
  source?: string | null
}

// ---------- 请求与事件 ----------

export const getActiveRequests = (c: SurgeConfig) =>
  get<{ requests: SurgeRequest[] }>(c, "/v1/requests/active")

export const getRecentRequests = (c: SurgeConfig) =>
  get<{ requests: SurgeRequest[] }>(c, "/v1/requests/recent")

export const killRequest = (c: SurgeConfig, id: number) =>
  post<void>(c, "/v1/requests/kill", { id })

export const getEvents = (c: SurgeConfig) => get<{ events: SurgeEvent[] }>(c, "/v1/events")

// ---------- 策略 ----------

export const getPolicies = (c: SurgeConfig) => get<{ proxies: string[] }>(c, "/v1/policies")

// Surge 自身的基准测试缓存（iOS ≥4.9.5）：按 lineHash 覆盖所有节点（含组内嵌/链式节点）
export type PolicyBenchmarkResult = {
  lastTestErrorMessage: string | null
  lastTestScoreInMS: number
  testing?: number
  lastTestDate?: number
}

export const getPolicyBenchmarks = (c: SurgeConfig) =>
  get<Record<string, PolicyBenchmarkResult>>(c, "/v1/policies/benchmark_results")

export const getPolicyGroups = (c: SurgeConfig) =>
  get<Record<string, PolicyOption[]>>(c, "/v1/policy_groups")

export const getPolicyGroupSelection = (c: SurgeConfig, groupName: string) =>
  get<{ policy: string }>(c, `/v1/policy_groups/select?group_name=${encodeURIComponent(groupName)}`)

export const selectPolicyGroup = (c: SurgeConfig, groupName: string, policy: string) =>
  post<void>(c, "/v1/policy_groups/select", { group_name: groupName, policy })

export const testPolicyGroup = (c: SurgeConfig, groupName: string, url?: string) =>
  post<{ available?: string[] }>(c, "/v1/policy_groups/test", {
    group_name: groupName,
    url: url ?? "http://www.gstatic.com/generate_204",
  })

export const getGroupTestResults = (c: SurgeConfig) =>
  get<GroupTestResult>(c, "/v1/policy_groups/test_results")

export const testPolicies = (c: SurgeConfig, names: string[], url?: string) =>
  post<PolicyTestResult>(c, "/v1/policies/test", {
    policy_names: names,
    url: url ?? "http://www.gstatic.com/generate_204",
  })

// ---------- 出站模式 ----------

export type OutboundMode = "rule" | "proxy" | "direct"

export const getOutboundMode = (c: SurgeConfig) =>
  get<{ mode: OutboundMode }>(c, "/v1/outbound")

export type ProbeResult = {
  mode?: OutboundMode
  deviceName?: string
  version?: string
  build?: string
  latencyMs: number
}

function headerGet(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  const h = headers as { get?: (k: string) => string | null; [k: string]: unknown }
  if (typeof h.get === "function") {
    const v = h.get(name) ?? h.get(name.toLowerCase())
    return v ?? undefined
  }
  const v = h[name] ?? h[name.toLowerCase()]
  return typeof v === "string" ? v : undefined
}

/** 连通性探针：读 /v1/outbound，尽量带上版本头 */
export async function probeOutbound(c: SurgeConfig): Promise<ProbeResult> {
  const t0 = Date.now()
  const res = await fetch(urlOf(c, "/v1/outbound"), {
    method: "GET",
    headers: { "X-Key": c.key },
    timeout: 10,
    allowInsecureRequest: allowInsecure(c),
    debugLabel: "surge-panel probe",
  }).catch((e) => {
    throw wrapFetchError(e)
  })
  const latencyMs = Date.now() - t0
  if (!res.ok) {
    throw httpStatusError(res.status)
  }
  let mode: OutboundMode | undefined
  try {
    const body = (await res.json()) as { mode?: OutboundMode }
    mode = body?.mode
  } catch {
    // 部分环境只关心连通
  }
  return {
    mode,
    version: headerGet(res.headers, "x-surge-version"),
    build: headerGet(res.headers, "x-surge-build"),
    latencyMs,
  }
}

export const getEnvironment = (c: SurgeConfig) =>
  get<{ deviceName?: string }>(c, "/v1/environment")

export const setOutboundMode = (c: SurgeConfig, mode: string) =>
  post<void>(c, "/v1/outbound", { mode })

export const getOutboundGlobal = (c: SurgeConfig) =>
  get<{ policy: string }>(c, "/v1/outbound/global")

export const setOutboundGlobal = (c: SurgeConfig, policy: string) =>
  post<void>(c, "/v1/outbound/global", { policy })

// ---------- 流量（实时速度） ----------

export type TrafficEntry = {
  in: number
  out: number
  inCurrentSpeed: number
  outCurrentSpeed: number
  inMaxSpeed: number
  outMaxSpeed: number
  lineHash?: string
}

export type TrafficSnapshot = {
  connector: Record<string, TrafficEntry>
  interface: Record<string, TrafficEntry>
  startTime: number
}

export const getTraffic = (c: SurgeConfig) => get<TrafficSnapshot>(c, "/v1/traffic")

// ---------- 规则 ----------

export const getRules = (c: SurgeConfig) =>
  get<{ rules: string[]; "available-policies": string[] }>(c, "/v1/rules")

// ---------- 脚本 ----------

export type SurgeScript = {
  name: string
  path: string
  type: string
  enabled: boolean
  parameters?: Record<string, string>
}

export const getScripts = (c: SurgeConfig) =>
  get<{ scripts: SurgeScript[] }>(c, "/v1/scripting")

export const runCronScript = (c: SurgeConfig, scriptName: string) =>
  post<unknown>(c, "/v1/scripting/cron/evaluate", { script_name: scriptName })

export const evaluateScript = (
  c: SurgeConfig,
  scriptText: string,
  mockType = "cron",
  timeout = 5
) =>
  post<unknown>(c, "/v1/scripting/evaluate", {
    script_text: scriptText,
    mock_type: mockType,
    timeout,
  })

// ---------- 策略详情 ----------

export const getPolicyDetail = (c: SurgeConfig, policyName: string) =>
  get<Record<string, string>>(
    c,
    `/v1/policies/detail?policy_name=${encodeURIComponent(policyName)}`
  )

// ---------- 日志级别 / 配置 ----------

export const setLogLevel = (c: SurgeConfig, level: string) =>
  post<void>(c, "/v1/log/level", { level })

export const getCurrentProfile = (c: SurgeConfig, sensitive = false) =>
  get<{ profile?: string } | string>(c, `/v1/profiles/current?sensitive=${sensitive ? 1 : 0}`)

export type ProfileLine =
  | { kind: "kv"; key: string; value: string }
  | { kind: "text"; text: string }

export type ProfileSection = {
  name: string
  lines: ProfileLine[]
}

/** 把 Surge 配置按 [Section] 切开，便于列表展示 */
export function parseProfileSections(profile: string): ProfileSection[] {
  const sections: ProfileSection[] = []
  let current: ProfileSection = { name: "", lines: [] }

  const pushCurrent = () => {
    if (current.name !== "" || current.lines.length > 0) sections.push(current)
  }

  for (const raw of profile.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^\[.+\]$/.test(line)) {
      pushCurrent()
      current = { name: line.slice(1, -1).trim(), lines: [] }
      continue
    }
    const eq = line.indexOf("=")
    if (eq > 0 && !line.startsWith("#") && !line.startsWith(";") && !line.startsWith("//")) {
      current.lines.push({
        kind: "kv",
        key: line.slice(0, eq).trim(),
        value: line.slice(eq + 1).trim(),
      })
      continue
    }
    current.lines.push({ kind: "text", text: line })
  }
  pushCurrent()
  return sections
}

/** 逗号分隔的长值拆成多行，避免挤成一块 */
export function formatProfileValue(value: string): string {
  if (!value.includes(",")) return value
  const parts = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length < 3 && value.length < 60) return value
  return parts.join(",\n")
}

// [Proxy Group] 顺序要拉整份配置才能解析，代价高且只在配置重载时才会变。
// 缓存到内存：面板内重载配置会失效；Surge 侧改配置后可下拉刷新强制重取。
let proxyGroupOrderCache: { key: string; order: string[] } | null = null

function configCacheKey(c: SurgeConfig): string {
  return `${c.protocol}://${c.host.trim()}:${c.port.trim()}`
}

export function invalidateProfileCache() {
  proxyGroupOrderCache = null
}

export async function getProxyGroupOrder(c: SurgeConfig, force = false): Promise<string[]> {
  const key = configCacheKey(c)
  if (!force && proxyGroupOrderCache?.key === key) return proxyGroupOrderCache.order
  const raw = await getCurrentProfile(c)
  const profile = typeof raw === "string" ? raw : (raw.profile ?? "")
  const order = parseProxyGroupOrder(profile)
  proxyGroupOrderCache = { key, order }
  return order
}

/** 从配置文本解析 [Proxy Group] 出现顺序，对齐 Surge App 列表 */
export function parseProxyGroupOrder(profile: string): string[] {
  const names: string[] = []
  let inGroup = false
  for (const raw of profile.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^\[.+\]$/.test(line)) {
      inGroup = /^\[Proxy Group\]$/i.test(line)
      continue
    }
    if (!inGroup || !line || line.startsWith("#") || line.startsWith(";") || line.startsWith("//")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    names.push(line.slice(0, eq).trim())
  }
  return names
}

export function orderPolicyGroupNames(names: string[], profileOrder: string[]): string[] {
  if (profileOrder.length === 0) return names
  const have = new Set(names)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const n of profileOrder) {
    if (have.has(n) && !seen.has(n)) {
      ordered.push(n)
      seen.add(n)
    }
  }
  for (const n of names) {
    if (!seen.has(n)) ordered.push(n)
  }
  return ordered
}

// ---------- 功能开关 / 模块 ----------

export type FeatureKey = "mitm" | "capture" | "rewrite" | "scripting"

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  mitm: "MitM",
  capture: "捕获",
  rewrite: "重写",
  scripting: "脚本",
}

export const getFeature = (c: SurgeConfig, f: FeatureKey) =>
  get<{ enabled: boolean }>(c, `/v1/features/${f}`)

export const setFeature = (c: SurgeConfig, f: FeatureKey, enabled: boolean) =>
  post<void>(c, `/v1/features/${f}`, { enabled })

export const getModules = (c: SurgeConfig) =>
  get<{ available: string[]; enabled: string[] }>(c, "/v1/modules")

export const setModule = (c: SurgeConfig, name: string, enabled: boolean) =>
  post<void>(c, "/v1/modules", { [name]: enabled })

// ---------- DNS ----------

export const getDns = (c: SurgeConfig) =>
  get<{ local: DnsEntry[]; dnsCache: DnsEntry[] }>(c, "/v1/dns")

export const flushDns = (c: SurgeConfig) => post<void>(c, "/v1/dns/flush")

export const testDnsDelay = (c: SurgeConfig, domain: string) =>
  post<{ delay: number }>(c, "/v1/test/dns_delay", { domain })

/** 商店版没有 /metrics 时，用 traffic / requests / dns 拼出总览可用的 gauge */
async function fallbackOverviewSamples(
  c: SurgeConfig,
  traffic?: TrafficSnapshot | null
): Promise<MetricSample[]> {
  const samples: MetricSample[] = []
  const snap = traffic ?? (await getTraffic(c).catch(() => null))
  if (snap) {
    const uptime = uptimeSecondsFromStartTime(snap.startTime)
    if (uptime !== null) {
      samples.push({ name: "surge_uptime_seconds", labels: {}, value: uptime })
    }
  }
  const [active, dns] = await Promise.all([
    getActiveRequests(c)
      .then((r) => r.requests?.length ?? 0)
      .catch(() => null as number | null),
    getDns(c)
      .then((r) => r.dnsCache?.length ?? 0)
      .catch(() => null as number | null),
  ])
  if (active !== null) samples.push({ name: "surge_active_requests", labels: {}, value: active })
  if (dns !== null) samples.push({ name: "surge_dns_cache_entries", labels: {}, value: dns })
  return samples
}

export async function fetchOverviewSamples(
  c: SurgeConfig,
  opts?: { skipMetrics?: boolean; traffic?: TrafficSnapshot | null }
): Promise<{ samples: MetricSample[]; fromMetrics: boolean }> {
  if (!opts?.skipMetrics) {
    const metrics = await fetchMetrics(c)
    if (metrics) return { samples: metrics, fromMetrics: true }
  }
  return { samples: await fallbackOverviewSamples(c, opts?.traffic), fromMetrics: false }
}

// ---------- 配置 / 引擎 ----------

export async function reloadProfile(c: SurgeConfig): Promise<void> {
  await post<void>(c, "/v1/profiles/reload")
  invalidateProfileCache()
}

export const stopEngine = (c: SurgeConfig) => post<void>(c, "/v1/stop")
