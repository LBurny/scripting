// 多实例：CRUD、旧单配置迁移、按实例存历史
import { DEFAULT_CONFIG, type SurgeConfig } from "./surgeApi"

export type SurgeInstance = {
  id: string
  name: string
  protocol: "http" | "https"
  host: string
  port: string
  key: string
  deviceName?: string
  version?: string
  build?: string
}

export const INSTANCES_KEY = "surge_panel_instances"
export const ACTIVE_ID_KEY = "surge_panel_active_id"
export const LEGACY_CONFIG_KEY = "surge_panel_config"
export const LEGACY_HISTORY_KEY = "surge_panel_history"

export function historyKey(id: string): string {
  return `surge_panel_history:${id}`
}

export function memLongKey(id: string): string {
  return `surge_panel_mem_long:${id}`
}

export function newInstanceId(): string {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function instanceToConfig(i: SurgeInstance): SurgeConfig {
  return { protocol: i.protocol, host: i.host, port: i.port, key: i.key }
}

export function defaultInstance(): SurgeInstance {
  return {
    id: newInstanceId(),
    name: "本机",
    ...DEFAULT_CONFIG,
  }
}

export function instanceSubtitle(i: SurgeInstance): string {
  const addr = `${i.host}:${i.port}`
  if (i.deviceName) return `${i.deviceName} · ${addr}`
  if (i.version) return `v${i.version} · ${addr}`
  return addr
}

function isInstance(v: unknown): v is SurgeInstance {
  if (!v || typeof v !== "object") return false
  const o = v as SurgeInstance
  return typeof o.id === "string" && typeof o.host === "string"
}

export function loadInstanceState(): { instances: SurgeInstance[]; activeId: string } {
  const raw = Storage.get(INSTANCES_KEY)
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isInstance)) {
    const savedId = Storage.get(ACTIVE_ID_KEY) as string | null
    const activeId = savedId && raw.some((i) => i.id === savedId) ? savedId : raw[0].id
    return { instances: raw, activeId }
  }

  const legacy = Storage.get(LEGACY_CONFIG_KEY) as SurgeConfig | null
  // 仅在旧版确实保存过连接时迁移；全新安装保持空列表，避免立刻去连
  if (!legacy || (!legacy.key?.trim() && !legacy.host?.trim())) {
    return { instances: [], activeId: "" }
  }
  const inst: SurgeInstance = {
    id: newInstanceId(),
    name: "本机",
    protocol: legacy.protocol ?? DEFAULT_CONFIG.protocol,
    host: legacy.host ?? DEFAULT_CONFIG.host,
    port: legacy.port ?? DEFAULT_CONFIG.port,
    key: legacy.key ?? DEFAULT_CONFIG.key,
  }
  const legacyHist = Storage.get(LEGACY_HISTORY_KEY)
  if (Array.isArray(legacyHist)) {
    Storage.set(historyKey(inst.id), legacyHist)
  }
  persistInstanceState([inst], inst.id)
  return { instances: [inst], activeId: inst.id }
}

export const EMPTY_INSTANCE: SurgeInstance = {
  id: "",
  name: "未配置",
  ...DEFAULT_CONFIG,
}

export function instanceIsReady(inst: SurgeInstance | undefined): boolean {
  return !!inst && inst.key.trim().length > 0 && inst.host.trim().length > 0
}

export function persistInstanceState(instances: SurgeInstance[], activeId: string) {
  Storage.set(INSTANCES_KEY, instances)
  Storage.set(ACTIVE_ID_KEY, activeId)
}

export function findInstance(instances: SurgeInstance[], id: string): SurgeInstance | undefined {
  return instances.find((i) => i.id === id)
}
