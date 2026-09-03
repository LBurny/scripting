// lib/preview.ts — 订阅预览：构造 surge 格式预览链接 + 解析返回的策略组与节点
// 预览统一用 surge 格式请求后端（INI 文本最易解析），分组/节点内容与最终配置一致

import { buildConvertUrl } from "./convert"
import type { ConvertParams } from "./convert"

export interface PreviewGroup {
  name: string
  /** surge 组类型：select / url-test / fallback / load-balance ... */
  type: string
  members: string[]
}

export interface PreviewResult {
  groups: PreviewGroup[]
  /** [Proxy] 段里的全部节点名（处理后，含 emoji/改名/过滤结果） */
  proxies: string[]
}

/** 解析 surge INI 配置文本，提取 [Proxy] 节点名与 [Proxy Group] 分组 */
export function parseSurgeConfig(text: string): PreviewResult {
  const result: PreviewResult = { groups: [], proxies: [] }
  let section = ""
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith("#") || line.startsWith(";")) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      section = sec[1].trim().toLowerCase()
      continue
    }
    if (section === "proxy") {
      const idx = line.indexOf("=")
      if (idx <= 0) continue
      // DIRECT/REJECT(-DROP/-TINYGIF 等) 内建行不是节点，跳过
      if (/^\s*(direct|reject)([\s,\-]|$)/i.test(line.slice(idx + 1))) continue
      const name = line.slice(0, idx).trim()
      if (name.length > 0) result.proxies.push(name)
    } else if (section === "proxy group") {
      const idx = line.indexOf("=")
      if (idx <= 0) continue
      const name = line.slice(0, idx).trim()
      if (name.length === 0) continue
      const parts = line
        .slice(idx + 1)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const type = parts.length > 0 ? parts[0] : ""
      // url-test/fallback 组尾部带 url=.../interval=... 参数段，丢弃
      const members = parts.slice(1).filter((s) => s.indexOf("=") === -1)
      result.groups.push({ name, type, members })
    }
  }
  return result
}

/** 构造预览链接：复用 buildConvertUrl，目标强制为 surge&ver=4 */
export function buildPreviewUrl(opts: {
  backend: string
  urls: string[]
  config?: string
  params?: Partial<ConvertParams>
}): string {
  return buildConvertUrl({ ...opts, target: "surge&ver=4" })
}

/** 请求后端转换并解析预览结果；网络/HTTP/格式错误均抛错 */
export async function fetchPreview(opts: {
  backend: string
  urls: string[]
  config?: string
  params?: Partial<ConvertParams>
}, timeoutMs = 25000): Promise<PreviewResult> {
  const url = buildPreviewUrl(opts)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res: any = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "clash.meta", "Accept": "*/*" },
    } as any)
    if (!res.ok) {
      let body = ""
      try { body = await res.text() } catch { }
      // 机场按 UA 拦截后端抓取时 subconverter 返回 400 "No nodes were found!"
      if (/no nodes were found/i.test(body)) {
        throw new Error("机场按访问来源拦截了后端抓取，该订阅无法经公共后端转换")
      }
      throw new Error(`后端返回 HTTP ${res.status}`)
    }
    const text: string = await res.text()
    if (!text || text.indexOf("[Proxy") === -1) {
      throw new Error("后端未返回 surge 配置（无法解析）")
    }
    return parseSurgeConfig(text)
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("请求超时")
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

export interface PreviewOutcome {
  result: PreviewResult
  /** 实际成功的后端（可能与所选不同——自动切换） */
  usedBackend: string
  /** 失败后端的「地址: 原因」列表 */
  errors: string[]
  /** 所选后端若已失败则为其原因（区分「不可用」与「响应慢」），否则为空串 */
  selectedError: string
}

export type PreviewFetcher = (opts: {
  backend: string
  urls: string[]
  config?: string
  params?: Partial<ConvertParams>
}, timeoutMs?: number) => Promise<PreviewResult>

function backendHost(b: string): string {
  return b.replace(/^https?:\/\//i, "").split("/")[0] || b
}

/**
 * 错峰竞速预览：所选后端立即发起，其余后端 staggerMs 后并行开跑，第一个成功的返回，
 * 其余在途请求结果被忽略（尚未发起的直接跳过）；全部失败抛汇总错误。fetcher 可注入（测试用）。
 * 相比顺序轮换：健康后端秒回，不再为挂死后端白等整个超时。
 */
export function fetchPreviewWithFallback(opts: {
  backend: string
  urls: string[]
  config?: string
  params?: Partial<ConvertParams>
  /** 候选后端池（可含所选，会去重，所选永远最先发起） */
  backends: string[]
}, timeoutMs = 15000, fetcher: PreviewFetcher = fetchPreview, staggerMs = 1500): Promise<PreviewOutcome> {
  const order: string[] = []
  for (const b of [opts.backend, ...opts.backends]) {
    const t = (b ?? "").trim()
    if (t.length > 0 && order.indexOf(t) === -1) order.push(t)
  }
  if (order.length === 0) return Promise.reject(new Error("无可用后端"))
  const selected = order[0]

  return new Promise<PreviewOutcome>((resolve, reject) => {
    const errors: string[] = []
    let selectedError = ""
    let settled = false
    let started = 0
    let pending = 0

    const maybeFail = () => {
      if (!settled && started === order.length && pending === 0) {
        settled = true
        reject(new Error("所有后端均失败\n" + errors.join("\n")))
      }
    }

    const start = (b: string) => {
      if (settled) return // 已有成功者，未发起的直接跳过
      started++
      pending++
      fetcher({
        backend: b,
        urls: opts.urls,
        config: opts.config,
        params: opts.params,
      }, timeoutMs).then((result) => {
        pending--
        if (settled) return
        settled = true
        resolve({ result, usedBackend: b, errors, selectedError })
      }).catch((e: any) => {
        pending--
        const reason = e?.message ?? String(e)
        errors.push(`${backendHost(b)}: ${reason}`)
        if (b === selected) selectedError = reason
        maybeFail()
      })
    }

    order.forEach((b, i) => {
      if (i === 0) start(b)
      else setTimeout(() => start(b), staggerMs)
    })
  })
}
