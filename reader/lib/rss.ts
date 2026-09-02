// lib/rss.ts — 轻量 RSS 2.0 / Atom / RDF 解析器（无 DOM 环境适用）

export interface ParsedArticle {
  guid: string
  title: string
  link: string
  /** HTML 摘要或全文 */
  content: string
  /** 内容来自 content:encoded / Atom content 等全文字段（而非 description/summary 摘要） */
  fullContent?: boolean
  /** 毫秒时间戳 */
  date: number
  author?: string
}

export interface ParsedFeed {
  title: string
  siteUrl: string
  articles: ParsedArticle[]
}

// ---------- 工具 ----------

// 命名实体白名单 + 组合单趟解码。
// 旧实现 9 趟全串 replace，每篇文章的 title/content 都过 9 遍；合并为一次扫描。
// 注意：&amp 与其他命名实体在同一趟处理是安全的——只替换命中的实体本身，
// 双转义（&amp;amp;）依旧只会解开一层，与旧实现的逐趟顺序结果一致。
const ENTITY_RE = /&(#[0-9]+|#x[0-9a-fA-F]+|quot|apos|lt|gt|nbsp|amp);/g
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  amp: "&",
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(ENTITY_RE, (m: string, body: string) => {
      if (body[0] === "#") {
        const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        // 非法码点（超界/NaN）保留原文，避免 String.fromCodePoint 抛 RangeError
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
      }
      return NAMED_ENTITIES[body]
    })
}

/** 去掉所有 XML 注释、DOCTYPE、处理指令 */
function stripProlog(xml: string): string {
  return xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?>/gi, "")
}

/**
 * 提取 xml 中所有 <tagName ...>...</tagName> 的完整块（含自闭合 <tag/>）。
 * tagName 支持命名空间，如 "content:encoded"。
 * 非严格解析，对 RSS 这种结构简单的文档足够健壮。
 */
function extractBlocks(xml: string, tagName: string): string[] {
  const results: string[] = []
  let openRe = rssReCache.get("#open:" + tagName)
  if (!openRe) {
    openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, "gi")
    rssReCache.set("#open:" + tagName, openRe)
  }
  openRe.lastIndex = 0
  const closeTag = `</${tagName}>`
  let m: RegExpExecArray | null
  while ((m = openRe.exec(xml))) {
    const start = m.index
    const openEnd = openRe.lastIndex
    // 自闭合标签
    if (xml.slice(Math.max(start, openEnd - 2), openEnd) === "/>") {
      results.push(xml.slice(start, openEnd))
      continue
    }
    const closeIdx = xml.indexOf(closeTag, openEnd)
    if (closeIdx === -1) break
    results.push(xml.slice(start, closeIdx + closeTag.length))
    openRe.lastIndex = closeIdx + closeTag.length
  }
  return results
}

// extractBlocks open 标签正则按标签名缓存（同 tag 的循环重入不存在：调用均顺序完成）
const rssReCache = new Map<string, RegExp>()

/** 取块内某子标签的文本内容（已解码实体、解 CDATA） */
function tagText(block: string, tagNames: string[]): string {
  for (const name of tagNames) {
    let re = rssReCache.get(name)
    if (!re) {
      re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")
      rssReCache.set(name, re)
    }
    const m = re.exec(block)
    if (m) return decodeEntities(m[2].trim())
  }
  return ""
}

/** 取 Atom <link href="..."/> 的 href（优先 rel=alternate 或无 rel） */
function atomLink(block: string): string {
  const links = extractBlocks(block, "link")
  let fallback = ""
  for (const l of links) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(l)?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(l)?.[1] ?? ""
    const rel = /rel\s*=\s*"([^"]*)"/i.exec(l)?.[1] ?? /rel\s*=\s*'([^']*)'/i.exec(l)?.[1] ?? "alternate"
    if (!href) continue
    if (rel === "alternate") return decodeEntities(href)
    if (!fallback) fallback = decodeEntities(href)
  }
  // RSS 的 <link>text</link>
  if (!fallback) fallback = tagText(block, ["link"])
  return fallback
}

function parseDate(s: string): number {
  if (!s) return 0
  const t = Date.parse(s.trim())
  return isNaN(t) ? 0 : t
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

export function plainSummary(html: string, maxLen = 120): string {
  const t = stripHtml(html)
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t
}

// ---------- 主解析 ----------

export function parseFeed(xml: string): ParsedFeed {
  const doc = stripProlog(xml)

  // 频道级信息
  const channelBlocks = extractBlocks(doc, "channel")
  const feedBlock = channelBlocks[0] ?? (extractBlocks(doc, "feed")[0] ?? doc)
  const feedTitle = tagText(feedBlock, ["title"]) || "Untitled"
  const siteUrl = atomLink(feedBlock)

  // 条目：RSS/RDF 用 item，Atom 用 entry
  const itemBlocks = extractBlocks(doc, "item")
  const entryBlocks = itemBlocks.length > 0 ? itemBlocks : extractBlocks(doc, "entry")

  const articles: ParsedArticle[] = entryBlocks.map(block => {
    const title = tagText(block, ["title"]) || "(无标题)"
    const link = atomLink(block)
    const full = tagText(block, ["content:encoded", "content", "encoded"])
    const content = full || tagText(block, ["description", "summary"]) || ""
    const dateStr =
      tagText(block, ["pubDate", "published", "updated", "dc:date", "date"]) || ""
    const guid = tagText(block, ["guid", "id"]) || link || title
    // Atom 的 author 常为 <author><name>x</name><uri>…</uri></author>，优先取 name
    const authorBlock = extractBlocks(block, "author")[0] ?? extractBlocks(block, "dc:creator")[0] ?? extractBlocks(block, "creator")[0] ?? ""
    const author = authorBlock
      ? tagText(authorBlock, ["name"]) || stripHtml(authorBlock.replace(/<\/?[\w:]+(\s[^>]*)?>/g, " "))
      : ""
    return {
      guid,
      title: decodeEntities(title),
      link,
      content, // 保留 HTML，阅读页用 WebView 渲染
      fullContent: !!full,
      date: parseDate(dateStr),
      author: author || undefined,
    }
  }).filter(a => a.link || a.content)

  articles.sort((a, b) => b.date - a.date)
  return { title: feedTitle, siteUrl, articles }
}

/** 抓取并解析一个订阅源 */
export async function fetchFeed(url: string, timeoutMs = 15000): Promise<ParsedFeed> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone) Scripting Reader/1.0",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const feed = parseFeed(text)
    if (!feed.articles.length) throw new Error("未解析到任何文章（不是有效的 RSS/Atom？）")
    return feed
  } finally {
    clearTimeout(timer)
  }
}
