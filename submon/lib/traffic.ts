// lib/traffic.ts — 订阅流量拉取与 subscription-userinfo 解析

export interface TrafficInfo {
  /** 已上传字节数 */
  upload: number
  /** 已下载字节数 */
  download: number
  /** 总流量字节数（0 = 未知/不限） */
  total: number
  /** 到期 unix 秒（0 = 未知/无限期） */
  expire: number
}

export interface FetchTarget {
  url: string
  /** 自定义 User-Agent（部分机场要求特定 UA 才返回流量头） */
  ua?: string
}

/** 解析 subscription-userinfo 头："upload=1; download=2; total=3; expire=4"（逗号分隔也支持） */
export function parseUserInfo(header: string): TrafficInfo {
  const info: TrafficInfo = { upload: 0, download: 0, total: 0, expire: 0 }
  if (!header) return info
  for (const part of header.split(/[;,]+/)) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim().toLowerCase()
    const raw = part.slice(idx + 1).trim()
    if (!/^(upload|download|total|expire)$/.test(key)) continue
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0) continue
    info[key as keyof TrafficInfo] = v
  }
  return info
}

/** 拉取一个订阅并解析流量信息；请求失败/HTTP 非 2xx/无流量头均抛错 */
export async function fetchTraffic(sub: FetchTarget, timeoutMs = 12000): Promise<TrafficInfo> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res: any = await fetch(sub.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": sub.ua?.trim() || "clash.meta", // 默认 clash.meta：多数机场只对 clash 系 UA 返回 subscription-userinfo
        "Accept": "*/*",
      },
    } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const header = res.headers?.get?.("subscription-userinfo") ?? ""
    if (!header) throw new Error("订阅未返回流量信息（subscription-userinfo 头缺失）")
    return parseUserInfo(header)
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("请求超时")
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}