// 当前实例的指标、流量、轮询；实例列表见 instances.ts
import { useEffect, useState } from "scripting"
import {
  fetchOverviewSamples,
  getRecentRequests,
  getTraffic,
  type SurgeConfig,
  type TrafficEntry,
  type TrafficSnapshot,
} from "./surgeApi"
import { appendMinuteSample, downsampleToMinute, gaugeValue, isRejectPolicy, type MetricSample, type MemoryPoint, type MemRangeMin } from "./metrics"
import {
  findInstance,
  historyKey,
  memLongKey,
  instanceIsReady,
  instanceToConfig,
  loadInstanceState,
  persistInstanceState,
  EMPTY_INSTANCE,
  type SurgeInstance,
} from "./instances"

export type HistoryPoint = {
  t: number
  mem: number
  inSpeed: number
  outSpeed: number
}

export type SpeedPoint = {
  t: number
  inSpeed: number
  outSpeed: number
}

export type Prefs = {
  autoRefresh: boolean
  intervalSec: 3 | 5 | 10
  maxPoints: 180 | 360 | 720
  /** 总览隐藏实例地址与本机 IP，方便截图分享 */
  hideAddresses: boolean
  /** 内存诊断查看范围（分钟） */
  memRangeMin: MemRangeMin
}

export type RequestsSegment = "active" | "recent" | "events" | "dns" | "rules"

export type StoreState = {
  instances: SurgeInstance[]
  activeId: string
  config: SurgeConfig
  prefs: Prefs
  samples: MetricSample[] | null
  prevSamples: MetricSample[] | null
  updatedAt: number | null
  error: string | null
  running: boolean
  speeds: { inSpeed: number; outSpeed: number }
  peakSpeeds: { inSpeed: number; outSpeed: number }
  failedRecent: number
  rejectedRecent: number
  history: HistoryPoint[]
  memLong: MemoryPoint[]
  speedHistory: SpeedPoint[]
  traffic: TrafficSnapshot | null
  /** null=未知；true=有 /metrics；false=商店版等无该端点，总览走 HTTP API 回退 */
  metricsAvailable: boolean | null
  requestsSegment: RequestsSegment
  visibleTab: number
}

const PREFS_KEY = "surge_panel_prefs"
const DEFAULT_PREFS: Prefs = {
  autoRefresh: true,
  intervalSec: 5,
  maxPoints: 720,
  hideAddresses: false,
  memRangeMin: 60,
}

function readPrefs(): Prefs {
  const saved = Storage.get(PREFS_KEY) as Partial<Prefs> | null
  return { ...DEFAULT_PREFS, ...(saved ?? {}) }
}

export const SPEED_REFRESH_MS = 1000
export const SPEED_HISTORY_SIZE = 60

function emptySpeedHistory(now = Date.now()): SpeedPoint[] {
  const out: SpeedPoint[] = []
  for (let i = SPEED_HISTORY_SIZE; i >= 1; i--) {
    out.push({ t: now - i * SPEED_REFRESH_MS, inSpeed: 0, outSpeed: 0 })
  }
  return out
}

function maxSpeedFromHistory(history: HistoryPoint[]): { inSpeed: number; outSpeed: number } {
  let inSpeed = 0
  let outSpeed = 0
  for (const p of history) {
    if (p.inSpeed > inSpeed) inSpeed = p.inSpeed
    if (p.outSpeed > outSpeed) outSpeed = p.outSpeed
  }
  return { inSpeed, outSpeed }
}

function readHistory(id: string): HistoryPoint[] {
  const raw = Storage.get(historyKey(id))
  return Array.isArray(raw) ? (raw as HistoryPoint[]) : []
}

function writeHistory(id: string, history: HistoryPoint[]) {
  Storage.set(historyKey(id), history)
}

function readMemLong(id: string, seed?: HistoryPoint[]): MemoryPoint[] {
  const raw = Storage.get(memLongKey(id))
  if (Array.isArray(raw) && raw.length > 0) return raw as MemoryPoint[]
  const seeded = seed ? downsampleToMinute(seed) : []
  if (id && seeded.length) Storage.set(memLongKey(id), seeded)
  return seeded
}

function writeMemLong(id: string, series: MemoryPoint[]) {
  Storage.set(memLongKey(id), series)
}

const boot = loadInstanceState()
const bootInst = findInstance(boot.instances, boot.activeId) ?? EMPTY_INSTANCE
const bootHistory = boot.activeId ? readHistory(boot.activeId) : []
const bootMemLong = boot.activeId ? readMemLong(boot.activeId, bootHistory) : []

let state: StoreState = {
  instances: boot.instances,
  activeId: boot.activeId,
  config: instanceToConfig(bootInst),
  prefs: DEFAULT_PREFS,
  samples: null,
  prevSamples: null,
  updatedAt: null,
  error: null,
  running: false,
  speeds: { inSpeed: 0, outSpeed: 0 },
  peakSpeeds: maxSpeedFromHistory(bootHistory),
  failedRecent: 0,
  rejectedRecent: 0,
  history: bootHistory,
  memLong: bootMemLong,
  speedHistory: emptySpeedHistory(),
  traffic: null,
  metricsAvailable: null,
  requestsSegment: "active",
  visibleTab: 0,
}

const listeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setTimeout> | null = null
let speedTimer: ReturnType<typeof setTimeout> | null = null
let tickCount = 0
let started = false
let trafficInFlight = false

// 采样每 intervalSec 一次，但序列化整个历史数组写 Storage 没必要那么勤：
// 攒在内存里，每 30 秒落盘一次，stopPolling / 切实例时强制 flush
const PERSIST_INTERVAL_MS = 30_000
let lastPersistAt = Date.now()

function flushHistory() {
  if (!state.activeId) return
  writeHistory(state.activeId, state.history)
  writeMemLong(state.activeId, state.memLong)
  lastPersistAt = Date.now()
}

function emit() {
  listeners.forEach((f) => f())
}

function patch(partial: Partial<StoreState>) {
  state = { ...state, ...partial }
  emit()
}

function applyActive(instances: SurgeInstance[], activeId: string, extra?: Partial<StoreState>) {
  if (instances.length === 0) {
    persistInstanceState([], "")
    patch({
      instances: [],
      activeId: "",
      config: instanceToConfig(EMPTY_INSTANCE),
      history: [],
      memLong: [],
      speedHistory: emptySpeedHistory(),
      peakSpeeds: { inSpeed: 0, outSpeed: 0 },
      samples: null,
      prevSamples: null,
      traffic: null,
      speeds: { inSpeed: 0, outSpeed: 0 },
      failedRecent: 0,
      rejectedRecent: 0,
      error: null,
      running: false,
      updatedAt: null,
      metricsAvailable: null,
      ...extra,
    })
    return
  }
  const inst = findInstance(instances, activeId) ?? instances[0]
  persistInstanceState(instances, inst.id)
  const history = readHistory(inst.id)
  const memLong = readMemLong(inst.id, history)
  lastPersistAt = Date.now()
  patch({
    instances,
    activeId: inst.id,
    config: instanceToConfig(inst),
    history,
    memLong,
    speedHistory: emptySpeedHistory(),
    peakSpeeds: maxSpeedFromHistory(history),
    samples: null,
    prevSamples: null,
    traffic: null,
    speeds: { inSpeed: 0, outSpeed: 0 },
    failedRecent: 0,
    rejectedRecent: 0,
    error: null,
    running: false,
    updatedAt: null,
    metricsAvailable: null,
    ...extra,
  })
}

export function needsSetup(): boolean {
  const inst = findInstance(state.instances, state.activeId) ?? state.instances[0]
  return !instanceIsReady(inst)
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getState(): StoreState {
  return state
}

export function useStore(): StoreState {
  const [s, setS] = useState<StoreState>(getState())
  useEffect(() => subscribe(() => setS(getState())), [])
  return s
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false
    }
  }
  return true
}

/**
 * 只订阅 store 的一个切片。speedHistory 每秒 patch 一次，useStore 会让所有
 * 已挂载 Tab 每秒整体重渲染；不需要秒级数据的视图应改用本 Hook。
 * selector 需为纯函数（首次渲染时捕获，不随渲染更新）。
 */
export function useStoreSelector<T>(selector: (s: StoreState) => T): T {
  const [snap, setSnap] = useState<T>(selector(getState()))
  useEffect(() => {
    let prev = snap
    const sync = () => {
      const next = selector(getState())
      if (!shallowEqual(prev, next)) {
        prev = next
        setSnap(next)
      }
    }
    sync()
    return subscribe(sync)
  }, [])
  return snap
}

export function activeInstance(): SurgeInstance {
  return findInstance(state.instances, state.activeId) ?? state.instances[0] ?? EMPTY_INSTANCE
}

export function initStore() {
  const loaded = loadInstanceState()
  applyActive(loaded.instances, loaded.activeId, {
    prefs: readPrefs(),
  })
}

export function savePrefs(prefs: Prefs) {
  const prev = state.prefs
  Storage.set(PREFS_KEY, prefs)
  const extra: Partial<StoreState> = {}
  // 缩短历史长度时立即裁剪，图表与设置不必等下一次采样才一致
  if (prefs.maxPoints < state.history.length) {
    extra.history = state.history.slice(-prefs.maxPoints)
    if (state.activeId) writeHistory(state.activeId, extra.history)
  }
  patch({ prefs, ...extra })
  if (
    started &&
    (prefs.autoRefresh !== prev.autoRefresh || prefs.intervalSec !== prev.intervalSec)
  ) {
    restartPolling()
  }
}

export function clearHistory() {
  Storage.remove(historyKey(state.activeId))
  Storage.remove(memLongKey(state.activeId))
  patch({
    history: [],
    memLong: [],
    speedHistory: emptySpeedHistory(),
    peakSpeeds: { inSpeed: 0, outSpeed: 0 },
  })
}

export function setVisibleTab(index: number) {
  if (state.visibleTab === index) return
  patch({ visibleTab: index })
}

/** 更新当前实例的连接字段（兼容旧 saveConfig 调用） */
export function saveConfig(config: SurgeConfig) {
  updateInstance(state.activeId, config)
}

export function updateInstance(id: string, patchInst: Partial<SurgeInstance>) {
  const instances = state.instances.map((i) => (i.id === id ? { ...i, ...patchInst } : i))
  persistInstanceState(instances, state.activeId)
  if (id === state.activeId) {
    const inst = findInstance(instances, id)!
    patch({ instances, config: instanceToConfig(inst) })
    void connectActive()
  } else {
    patch({ instances })
  }
}

export function addInstance(inst: SurgeInstance) {
  const instances = [...state.instances, inst]
  persistInstanceState(instances, state.activeId)
  patch({ instances })
}

export async function connectActive() {
  if (!instanceIsReady(activeInstance())) return
  if (started) await refreshNow()
  else await startPolling()
}

export async function switchInstance(id: string) {
  if (id === state.activeId) return
  stopPolling()
  applyActive(state.instances, id)
  await connectActive()
}

export async function deleteInstance(id: string) {
  const instances = state.instances.filter((i) => i.id !== id)
  if (id === state.activeId || instances.length === 0) {
    // 先停轮询（flush 会写当前实例的键），再删除键，避免刚删又被写回
    stopPolling()
    Storage.remove(historyKey(id))
    Storage.remove(memLongKey(id))
    applyActive(instances, instances[0]?.id ?? "")
    await connectActive()
  } else {
    Storage.remove(historyKey(id))
    Storage.remove(memLongKey(id))
    persistInstanceState(instances, state.activeId)
    patch({ instances })
  }
}

// ---------- Tab 跳转 ----------

let tabJump: ((index: number) => void) | null = null

export function registerTabJump(fn: (index: number) => void) {
  tabJump = fn
  return () => {
    if (tabJump === fn) tabJump = null
  }
}

export function setRequestsSegment(segment: RequestsSegment) {
  if (state.requestsSegment === segment) return
  patch({ requestsSegment: segment })
}

export function openRequestsSegment(segment: RequestsSegment) {
  patch({ requestsSegment: segment })
  tabJump?.(3)
}

export function openTrafficTab() {
  tabJump?.(2)
}

// ---------- 实时速率 ----------

function aggregateCurrentSpeeds(entries: Record<string, TrafficEntry>): {
  inSpeed: number
  outSpeed: number
} {
  let inSpeed = 0
  let outSpeed = 0
  for (const name in entries) {
    const e = entries[name]
    inSpeed += e.inCurrentSpeed
    outSpeed += e.outCurrentSpeed
  }
  return { inSpeed, outSpeed }
}

async function tickTraffic() {
  if (needsSetup() || trafficInFlight) return
  trafficInFlight = true
  const t0 = Date.now()
  try {
    const traffic = await getTraffic(state.config)
    const source =
      traffic.interface && Object.keys(traffic.interface).length > 0
        ? traffic.interface
        : traffic.connector
    const { inSpeed, outSpeed } = aggregateCurrentSpeeds(source ?? {})
    const now = Date.now()
    const nextHistory = state.speedHistory.slice()
    nextHistory.push({ t: now, inSpeed, outSpeed })
    while (nextHistory.length > SPEED_HISTORY_SIZE) nextHistory.shift()
    patch({
      traffic,
      speeds: { inSpeed, outSpeed },
      speedHistory: nextHistory,
      peakSpeeds: {
        inSpeed: Math.max(state.peakSpeeds.inSpeed, inSpeed),
        outSpeed: Math.max(state.peakSpeeds.outSpeed, outSpeed),
      },
      running: true,
      updatedAt: now,
    })
  } catch (e) {
    if (!state.samples) {
      patch({ error: String(e), running: false, updatedAt: Date.now() })
    }
  } finally {
    trafficInFlight = false
  }
  return Date.now() - t0
}

function armTraffic(delay: number) {
  if (!started || !state.prefs.autoRefresh) return
  speedTimer = setTimeout(async () => {
    if (!started || !state.prefs.autoRefresh) return
    const elapsed = (await tickTraffic()) ?? 0
    armTraffic(Math.max(0, SPEED_REFRESH_MS - elapsed))
  }, delay)
}

async function tick() {
  if (needsSetup()) return
  const { config, prefs, samples: prev, history, speeds, activeId, metricsAvailable, traffic } = state
  const now = Date.now()
  try {
    const { samples, fromMetrics } = await fetchOverviewSamples(config, {
      skipMetrics: metricsAvailable === false,
      traffic,
    })
    const mem = fromMetrics ? gaugeValue(samples, "surge_memory_bytes") : null
    let newHistory = history
    let newMemLong = state.memLong
    if (mem !== null) {
      const point: HistoryPoint = { t: now, mem, inSpeed: speeds.inSpeed, outSpeed: speeds.outSpeed }
      newHistory = [...history, point]
      while (newHistory.length > prefs.maxPoints) newHistory.shift()
      newMemLong = appendMinuteSample(state.memLong, { t: now, mem })
      if (now - lastPersistAt >= PERSIST_INTERVAL_MS) {
        writeHistory(activeId, newHistory)
        writeMemLong(activeId, newMemLong)
        lastPersistAt = now
      }
    }
    patch({
      samples,
      prevSamples: prev ?? null,
      updatedAt: now,
      error: null,
      running: true,
      history: newHistory,
      memLong: newMemLong,
      metricsAvailable: fromMetrics,
    })
  } catch (e) {
    patch({
      error: String(e),
      running: state.traffic !== null,
      updatedAt: now,
    })
  }

  tickCount++
  // 请求 Tab 可见时由该页自己轮询，这里不再重复拉最近请求
  if (tickCount % 3 === 1 && state.visibleTab !== 3) {
    try {
      const { requests } = await getRecentRequests(state.config)
      patch({
        failedRecent: requests.filter((r) => r.failed).length,
        rejectedRecent: requests.filter((r) => r.rejected || isRejectPolicy(r.policyName)).length,
      })
    } catch {
      // 忽略
    }
  }
}

function scheduleNext() {
  if (!state.prefs.autoRefresh) return
  pollTimer = setTimeout(async () => {
    await tick()
    scheduleNext()
  }, state.prefs.intervalSec * 1000)
}

function clearTimers() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  if (speedTimer) {
    clearTimeout(speedTimer)
    speedTimer = null
  }
}

function restartPolling() {
  clearTimers()
  scheduleNext()
  armTraffic(SPEED_REFRESH_MS)
}

export async function startPolling() {
  if (started) return
  if (needsSetup()) return
  started = true
  await Promise.all([tick(), tickTraffic()])
  scheduleNext()
  armTraffic(SPEED_REFRESH_MS)
}

export function stopPolling() {
  started = false
  clearTimers()
  flushHistory()
}

export async function refreshNow() {
  if (needsSetup()) return
  if (state.metricsAvailable === false) patch({ metricsAvailable: null })
  await Promise.all([tick(), tickTraffic()])
}
