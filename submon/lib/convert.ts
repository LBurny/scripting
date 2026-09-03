// lib/convert.ts — subconverter 转换链接构造（纯函数，无 IO）
// 参考 tindy2013/subconverter /sub API 与 CareyWang/sub-web、youshandefeiyang/sub-web-modify 的参数约定

export interface ConvertTarget {
  value: string
  label: string
}

/** 支持的目标客户端（subconverter target 值；surge 用 &ver= 附加版本） */
export const CONVERT_TARGETS: ConvertTarget[] = [
  { value: "clash", label: "Clash" },
  { value: "clash.meta", label: "Clash.Meta (mihomo)" },
  { value: "clashr", label: "ClashR" },
  { value: "surge&ver=4", label: "Surge 4" },
  { value: "quanx", label: "Quantumult X" },
  { value: "quan", label: "Quantumult" },
  { value: "loon", label: "Loon" },
  { value: "singbox", label: "sing-box" },
  { value: "surfboard", label: "Surfboard" },
  { value: "mellow", label: "Mellow" },
  { value: "ss", label: "SS (Shadowsocks)" },
  { value: "ssr", label: "SSR" },
  { value: "vmess", label: "V2Ray (vmess)" },
  { value: "trojan", label: "Trojan" },
]

/** 内置公共后端（已规范化为 .../sub? 形式） */
export const BUILTIN_BACKENDS: string[] = [
  "https://api.dler.io/sub?",
  "https://sub.xeton.dev/sub?",
  "https://sub.maoxiong.pro/sub?",
  "https://api.wcc.best/sub?",
  "https://sub.id9.cc/sub?",
]

export interface RemoteConfig {
  label: string
  url: string
}

const ACL_BASE = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config"

/** 内置 ACL4SSR 远程配置预设 */
export const BUILTIN_CONFIGS: RemoteConfig[] = [
  { label: "ACL4SSR 在线默认版", url: `${ACL_BASE}/ACL4SSR_Online.ini` },
  { label: "ACL4SSR 在线全分组", url: `${ACL_BASE}/ACL4SSR_Online_Full.ini` },
  { label: "ACL4SSR 在线精简版", url: `${ACL_BASE}/ACL4SSR_Online_Mini.ini` },
  { label: "ACL4SSR 全分组去广告", url: `${ACL_BASE}/ACL4SSR_Online_Full_AdblockPlus.ini` },
  { label: "ACL4SSR 多模式", url: `${ACL_BASE}/ACL4SSR_Online_MultiMode.ini` },
  { label: "ACL4SSR 多模式全分组", url: `${ACL_BASE}/ACL4SSR_Online_Full_MultiMode.ini` },
  { label: "ACL4SSR 本地版", url: `${ACL_BASE}/ACL4SSR.ini` },
  { label: "ACL4SSR 本地精简版", url: `${ACL_BASE}/ACL4SSR_Mini.ini` },
]

/** 转换高级参数（subconverter 查询参数约定，布尔全传 true/false） */
export interface ConvertParams {
  insert: boolean
  emoji: boolean
  udp: boolean
  tfo: boolean
  scv: boolean
  fdn: boolean
  sort: boolean
  expand: boolean
  include: string
  exclude: string
}

/** 默认参数：emoji/udp 开，其余关（与常见前端默认一致） */
export const DEFAULT_PARAMS: ConvertParams = {
  insert: false,
  emoji: true,
  udp: true,
  tfo: false,
  scv: false,
  fdn: false,
  sort: false,
  expand: false,
  include: "",
  exclude: "",
}

/** 后端地址规范化：trim → 去尾部空白与 ? → 路径不以 sub 结尾补 /sub → 补 ? */
export function normalizeBackend(input: string): string {
  let s = input.trim()
  while (s.length > 0 && (s.endsWith("?") || s.endsWith(" "))) s = s.slice(0, -1).trimEnd()
  if (s.length === 0) return s
  if (!/sub\/?$/.test(s)) s = s.replace(/\/+$/, "") + "/sub"
  return s + "?"
}

/** 订阅链接列表规范化：按换行/竖线分割 → trim → 去空 → 保序去重 */
export function normalizeUrlList(input: string): string[] {
  const parts = input.split(/[\n\r|]+/).map((x) => x.trim()).filter((x) => x.length > 0)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * 构造 subconverter 转换链接。
 * 顺序固定：target, url, config(空省略), 8 个布尔全传, include/exclude(非空才传)。
 * target 允许内嵌 &（如 "surge&ver=4"，直接拼为 target=surge&ver=4）。
 */
export function buildConvertUrl(opts: {
  backend: string
  target: string
  urls: string[]
  config?: string
  params?: Partial<ConvertParams>
}): string {
  const backend = normalizeBackend(opts.backend)
  if (backend.length === 0) throw new Error("后端地址为空")
  const urls = (opts.urls ?? []).map((u) => u.trim()).filter((u) => u.length > 0)
  if (urls.length === 0) throw new Error("请至少填入一个订阅链接")
  const target = opts.target.trim()
  if (target.length === 0) throw new Error("请选择目标客户端")

  const p: ConvertParams = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) }

  const parts: string[] = []
  parts.push(`target=${target}`)
  parts.push(`url=${encodeURIComponent(urls.join("|"))}`)
  const config = (opts.config ?? "").trim()
  if (config.length > 0) parts.push(`config=${encodeURIComponent(config)}`)
  parts.push(`insert=${p.insert}`)
  parts.push(`emoji=${p.emoji}`)
  parts.push(`udp=${p.udp}`)
  parts.push(`tfo=${p.tfo}`)
  parts.push(`scv=${p.scv}`)
  parts.push(`fdn=${p.fdn}`)
  parts.push(`sort=${p.sort}`)
  parts.push(`expand=${p.expand}`)
  if (p.include.trim().length > 0) parts.push(`include=${encodeURIComponent(p.include.trim())}`)
  if (p.exclude.trim().length > 0) parts.push(`exclude=${encodeURIComponent(p.exclude.trim())}`)

  return backend + parts.join("&")
}