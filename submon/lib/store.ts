// lib/store.ts — 流量快照缓存（traffic.json，App Group 目录）与刷新编排

import { fetchTraffic } from "./traffic"
import type { TrafficInfo } from "./traffic"
import { loadSubs } from "./subs"
import type { Sub } from "./subs"

export interface SubState {
  /** 最近一次成功的流量信息（null = 从未成功） */
  info: TrafficInfo | null
  /** 最近一次刷新的错误（null = 上次成功或从未尝试） */
  error: string | null
  /** 最近成功刷新时间 ms */
  updatedAt: number
  /** 最近尝试刷新时间 ms */
  attemptedAt: number
}

const DIR = FileManager.appGroupDocumentsDirectory + "/submon"
const STATES_FILE = DIR + "/traffic.json"

// 进程内缓存：首次读盘后命中内存；小组件是独立进程，各自读盘
let statesCache: Record<string, SubState> | null = null

function ensureDir() {
  if (!FileManager.existsSync(DIR)) FileManager.createDirectorySync(DIR, true)
}

export function loadStates(): Record<string, SubState> {
  if (statesCache) return statesCache
  ensureDir()
  if (!FileManager.existsSync(STATES_FILE)) {
    statesCache = {}
    return statesCache
  }
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(STATES_FILE))
    statesCache = parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    statesCache = {}
  }
  return statesCache!
}

export function saveStates(states: Record<string, SubState>): void {
  ensureDir()
  statesCache = { ...states }
  FileManager.writeAsStringSync(STATES_FILE, JSON.stringify(states, null, 2))
}

/** 刷新全部订阅：成功写 info；失败保留旧 info 并记 error。空订阅列表不写盘 */
export async function refreshAll(
  fetcher: (sub: { url: string; ua?: string }) => Promise<TrafficInfo> = fetchTraffic,
  subs: Sub[] = loadSubs(),
): Promise<void> {
  if (subs.length === 0) return
  const states = loadStates()
  const now = Date.now()
  await Promise.allSettled(subs.map(async (sub) => {
    const prev: SubState = states[sub.url] ?? { info: null, error: null, updatedAt: 0, attemptedAt: 0 }
    try {
      const info = await fetcher(sub)
      states[sub.url] = { info, error: null, updatedAt: now, attemptedAt: now }
    } catch (e: any) {
      states[sub.url] = {
        info: prev.info,
        error: String(e?.message ?? e),
        updatedAt: prev.updatedAt,
        attemptedAt: now,
      }
    }
  }))
  saveStates(states)
}