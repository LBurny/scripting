// lib/convertStore.ts — 转换相关持久化：历史 / 自定义后端与配置 / 上次表单
// 直接读写盘（文件小、低频），不做进程内缓存，避免测试与多入口数据陈旧问题

export interface ConvertHistoryEntry {
  id: string
  /** 完整转换链接（去重主键） */
  url: string
  backend: string
  target: string
  config: string
  urls: string[]
  createdAt: number
}

export interface CustomLists {
  backends: string[]
  configs: string[]
}

const DIR = FileManager.appGroupDocumentsDirectory + "/submon"
const HISTORY_FILE = DIR + "/convert_history.json"
const CUSTOM_FILE = DIR + "/convert_custom.json"
const FORM_FILE = DIR + "/convert_form.json"

const HISTORY_CAP = 30

let seq = 0
function genId(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function ensureDir() {
  if (!FileManager.existsSync(DIR)) FileManager.createDirectorySync(DIR, true)
}

function readJson<T>(file: string, fallback: T): T {
  ensureDir()
  if (!FileManager.existsSync(file)) return fallback
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(file))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: any): void {
  ensureDir()
  FileManager.writeAsStringSync(file, JSON.stringify(value, null, 2))
}

// ---------- 转换历史 ----------

export function loadHistory(): ConvertHistoryEntry[] {
  const parsed = readJson<any[]>(HISTORY_FILE, [])
  return Array.isArray(parsed) ? parsed : []
}

/** 新增历史：自动补 id/createdAt；按 url 去重（旧同 url 移除）；最新在前；cap 30 */
export function addHistory(e: {
  url: string
  backend: string
  target: string
  config: string
  urls: string[]
}): ConvertHistoryEntry[] {
  const list = loadHistory().filter((h) => h.url !== e.url)
  const item: ConvertHistoryEntry = { id: genId(), createdAt: Date.now(), ...e }
  list.unshift(item)
  const capped = list.slice(0, HISTORY_CAP)
  writeJson(HISTORY_FILE, capped)
  return capped
}

/** 按 id 删除，返回删除后的列表 */
export function removeHistory(id: string): ConvertHistoryEntry[] {
  const list = loadHistory().filter((h) => h.id !== id)
  writeJson(HISTORY_FILE, list)
  return list
}

export function clearHistory(): void {
  writeJson(HISTORY_FILE, [])
}

// ---------- 自定义后端 / 远程配置 ----------

export function loadCustom(): CustomLists {
  const parsed = readJson<Partial<CustomLists>>(CUSTOM_FILE, {})
  return {
    backends: Array.isArray(parsed.backends) ? parsed.backends : [],
    configs: Array.isArray(parsed.configs) ? parsed.configs : [],
  }
}

export function saveCustom(lists: CustomLists): void {
  writeJson(CUSTOM_FILE, {
    backends: lists.backends ?? [],
    configs: lists.configs ?? [],
  })
}

// ---------- 上次表单 ----------

export function loadLastForm(): Record<string, any> {
  const parsed = readJson<Record<string, any>>(FORM_FILE, {})
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}
}

export function saveLastForm(form: Record<string, any>): void {
  writeJson(FORM_FILE, form)
}