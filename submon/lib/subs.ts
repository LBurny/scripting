// lib/subs.ts — 订阅配置 CRUD（subscriptions.json，App Group 目录小组件可读）

export interface Sub {
  /** 订阅链接（规范化后作为主键） */
  url: string
  /** 显示名 */
  name: string
  /** 自定义 User-Agent（选填） */
  ua?: string
  /** 添加时间 ms */
  addedAt: number
}

const DIR = FileManager.appGroupDocumentsDirectory + "/submon"
const SUBS_FILE = DIR + "/subscriptions.json"

// 进程内缓存：首次读盘后命中内存（仿 reader loadFeeds）
let subsCache: Sub[] | null = null

function ensureDir() {
  if (!FileManager.existsSync(DIR)) FileManager.createDirectorySync(DIR, true)
}

/** 规范化订阅链接：trim，无协议前缀补 https:// */
export function normalizeUrl(url: string): string {
  const u = url.trim()
  if (!u) return ""
  if (!/^https?:\/\//i.test(u)) return "https://" + u
  return u
}

export function loadSubs(): Sub[] {
  if (subsCache) return subsCache
  ensureDir()
  if (!FileManager.existsSync(SUBS_FILE)) {
    subsCache = []
    return subsCache
  }
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(SUBS_FILE))
    subsCache = Array.isArray(parsed) ? parsed : []
  } catch {
    subsCache = []
  }
  return subsCache
}

export function saveSubs(subs: Sub[]): void {
  ensureDir()
  subsCache = [...subs]
  FileManager.writeAsStringSync(SUBS_FILE, JSON.stringify(subs, null, 2))
}

/** 添加订阅：链接规范化后去重；空名兜底 "我的订阅" */
export async function addSub(url: string, name: string, ua?: string): Promise<Sub> {
  const norm = normalizeUrl(url)
  if (!norm) throw new Error("订阅链接不能为空")
  const subs = loadSubs()
  const dup = subs.find((s) => s.url === norm)
  if (dup) throw new Error(`该订阅已存在（列表里的「${dup.name}」），无需重复添加；长按可编辑或删除`)
  const sub: Sub = {
    url: norm,
    name: name.trim() || "我的订阅",
    ...(ua && ua.trim() ? { ua: ua.trim() } : {}),
    addedAt: Date.now(),
  }
  subs.push(sub)
  saveSubs(subs)
  return sub
}

/** 更新订阅（url 为主键不可改） */
export function updateSub(url: string, patch: Partial<Sub>): void {
  const subs = loadSubs()
  const sub = subs.find((s) => s.url === url)
  if (!sub) return
  if (patch.name !== undefined) sub.name = patch.name.trim() || sub.name
  if (patch.ua !== undefined) {
    const ua = patch.ua.trim()
    if (ua) sub.ua = ua
    else delete sub.ua
  }
  saveSubs(subs)
}

export function removeSub(url: string): void {
  saveSubs(loadSubs().filter((s) => s.url !== url))
}