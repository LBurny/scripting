// lib/fulltext.ts — 网页正文提取（无 DOM 环境：标签配平扫描 + 启发式清理）

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

// 正则缓存：scanClose/extractBlocks/getAttr/removeTagBlocks 都按标签名动态构造正则，
// MB 级页面上每个区块都 new RegExp 的编译开销可观，按 source+flags 缓存复用。
const reCache = new Map<string, RegExp>()
function cachedRe(source: string, flags: string): RegExp {
  const key = flags + "::" + source
  let re = reCache.get(key)
  if (!re) {
    re = new RegExp(source, flags)
    reCache.set(key, re)
  }
  re.lastIndex = 0
  return re
}

/** 从 from 处扫描，找与 tag 配平的闭合标签，返回闭合标签之后的下标；找不到返回 -1 */
function scanClose(html: string, from: number, tag: string): number {
  const re = cachedRe(`<\\/?${tag}(\\s[^>]*?)?\\/?>`, "gi")
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const t = m[0]
    if (t.endsWith("/>")) continue
    if (t.startsWith("</")) {
      depth--
      if (depth === 0) return m.index + t.length
    } else {
      depth++
    }
  }
  return -1
}

/** 提取所有 <tag>…</tag> 区块（含标签本身），支持嵌套配平 */
function extractBlocks(html: string, tag: string): string[] {
  const out: string[] = []
  const open = cachedRe(`<${tag}(\\s[^>]*?)?>`, "gi")
  let m: RegExpExecArray | null
  while ((m = open.exec(html))) {
    const end = scanClose(html, m.index + m[0].length, tag)
    if (end > 0) {
      out.push(html.slice(m.index, end))
      open.lastIndex = end
    } else {
      break
    }
  }
  return out
}

/** 删除所有 <tag>…</tag> 区块（如 script/style/nav），支持嵌套配平。
 *  旧实现每删一块就整串 slice+concat 两次并从 0 重扫，MB 级页面是 O(块数×文档大小) 拷贝；
 *  改为先收集全部待删区间再一次拼接重建（顺带消除原来每标签 50 块的上限）。 */
export function removeTagBlocks(html: string, tags: string[]): string {
  const ranges: [number, number][] = []
  for (const tag of tags) {
    const open = cachedRe(`<${tag}(\\s[^>]*?)?\\/?>`, "gi")
    let m: RegExpExecArray | null
    while ((m = open.exec(html))) {
      if (m[0].endsWith("/>")) {
        ranges.push([m.index, open.lastIndex])
        continue
      }
      const end = scanClose(html, open.lastIndex, tag)
      if (end > 0) {
        ranges.push([m.index, end])
        open.lastIndex = end // 跳过已删区块内部
      } else {
        ranges.push([m.index, open.lastIndex])
      }
    }
  }
  if (!ranges.length) return html
  ranges.sort((a, b) => a[0] - b[0])
  let out = ""
  let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue // 嵌套/重叠区块：外层已覆盖
    out += html.slice(pos, s)
    pos = e
  }
  return out + html.slice(pos)
}

// 版面噪声容器（class/id 命中即整块删除）
const BOILERPLATE_RE =
  /(article[-_]?header|post[-_]?header|entry[-_]?header|page[-_]?header|share|related|recommend|comment|sidebar|breadcrumb|pagination|advert|sns|social[-_]?link|copyright|license|qrcode|qr[-_]?code|author[-_]?card|author[-_]?box|popup|modal|toast|paywall|subscribe[-_]?box|newsletter)/i

/** 扫描删除：收集所有 class/id 命中噪声正则的 div/section 区块，一次拼接重建 */
export function removeBoilerplateScan(html: string): string {
  const re = /<(div|section)(\s[^>]*?)?>/gi
  const ranges: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[2] ?? ""
    const cls = /\b(?:class|id)\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? ""
    if (!BOILERPLATE_RE.test(cls)) continue
    const end = scanClose(html, m.index + m[0].length, m[1].toLowerCase())
    if (end > 0) {
      ranges.push([m.index, end])
      re.lastIndex = end // 跳过已删区块内部
    }
  }
  // ranges 由 exec 顺序保证递增且互不重叠，单次拼接即可（旧实现逐段 slice+concat 是 O(区间数×文档大小)）
  let out = ""
  let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue
    out += html.slice(pos, s)
    pos = e
  }
  return out + html.slice(pos)
}

/** 相对 URL → 绝对 URL */
export function resolveUrl(rel: string, base: string): string {
  if (/^(https?:)?\/\//i.test(rel)) {
    if (rel.startsWith("//")) return (/^https:/i.test(base) ? "https:" : "http:") + rel
    return rel
  }
  if (/^(data:|blob:|mailto:|javascript:|#)/i.test(rel)) return rel
  const origin = /^(https?:\/\/[^/]+)/i.exec(base)?.[1]
  if (!origin) return rel
  if (rel.startsWith("/")) return origin + rel
  const path = base.split(/[?#]/)[0]
  const dir = path.slice(0, path.lastIndexOf("/") + 1)
  return dir + rel
}

function getAttr(tag: string, name: string): string | null {
  const re = cachedRe(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")
  return re.exec(tag)?.[2] ?? null
}

/** 清洗标签：白名单保留、属性精简、懒加载 src 修复、相对 URL 绝对化 */
function cleanTags(html: string, baseUrl: string): string {
  const KEEP = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "img", "figure", "figcaption",
    "blockquote", "pre", "code", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
    "a", "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup", "span", "div",
    "section", "article", "video", "source", "kbd", "abbr", "cite", "q", "dl", "dt", "dd",
  ])
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g,
    (raw, name: string, attrs: string) => {
      const tag = name.toLowerCase()
      if (!KEEP.has(tag)) return "" // 直接剥掉未知标签（保留内部文本）
      const closing = raw.startsWith("</")
      if (closing) return `</${tag}>`
      if (tag === "img") {
        const src = getAttr(raw, "src") ?? getAttr(raw, "data-src") ?? getAttr(raw, "data-original")
        if (!src || src.startsWith("data:")) return ""
        const alt = getAttr(raw, "alt") ?? ""
        return `<img src="${resolveUrl(src, baseUrl)}" alt="${alt.replace(/"/g, "&quot;")}">`
      }
      if (tag === "a") {
        const href = getAttr(raw, "href")
        return href ? `<a href="${resolveUrl(href, baseUrl)}">` : "<a>"
      }
      if (tag === "video" || tag === "source") {
        const src = getAttr(raw, "src")
        return src ? `<${tag} src="${resolveUrl(src, baseUrl)}" controls>` : ""
      }
      if (tag === "td" || tag === "th") {
        const colspan = getAttr(raw, "colspan")
        const rowspan = getAttr(raw, "rowspan")
        return `<${tag}${colspan ? ` colspan="${colspan}"` : ""}${rowspan ? ` rowspan="${rowspan}"` : ""}>`
      }
      return `<${tag}>`
    })
}

/** 提取正文：优先最长的 <article>/<main>，其次 <body> */
function pickMainBlock(html: string): string {
  const candidates: string[] = []
  for (const tag of ["article", "main"]) {
    candidates.push(...extractBlocks(html, tag))
  }
  const textLen = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length
  candidates.sort((a, b) => textLen(b) - textLen(a))
  if (candidates.length && textLen(candidates[0]) >= 200) return candidates[0]
  const body = extractBlocks(html, "body")[0]
  return body ?? html
}

/** 从网页 HTML 提取正文片段（失败时抛错） */
export function extractArticle(html: string, baseUrl: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, "")
  s = removeTagBlocks(s, ["script", "style", "noscript", "template", "svg", "iframe", "form", "button", "select", "nav"])
  s = pickMainBlock(s)
  s = removeBoilerplateScan(s)
  // 去掉首个 h1（与阅读页标题重复）
  s = s.replace(/<h1(\s[^>]*?)?>[\s\S]*?<\/h1>/i, "")
  s = cleanTags(s, baseUrl)
  const textLen = s.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length
  if (textLen < 150) throw new Error("未能提取到正文（该站可能需要登录或为动态渲染）")
  return s
}

/** 抓取文章页并提取正文 HTML */
export async function fetchFullText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()
    return extractArticle(html, url)
  } finally {
    clearTimeout(timer)
  }
}
