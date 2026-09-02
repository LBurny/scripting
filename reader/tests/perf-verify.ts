// tests/perf-verify.ts — 性能优化回归验证：新实现输出与旧实现逐字节等价 + 耗时对比
// 独立脚本无 UI：scripting-ts run 会挂到超时（exit 124，无害），结果看结果文件。
// 结果：App Group/scripting-agent/workspace/default/perf-verify-result.txt
import { extractArticle, removeTagBlocks, removeBoilerplateScan } from "../lib/fulltext"
import { parseFeed, decodeEntities } from "../lib/rss"
import { Article, capArticles } from "../lib/store"

// ---------- 旧实现副本（改动前代码，逐字拷贝，用于等价性与耗时基线） ----------

function oldScanClose(html: string, from: number, tag: string): number {
  const re = new RegExp(`<\\/?${tag}(\\s[^>]*?)?\\/?>`, "gi")
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

function oldRemoveTagBlocks(html: string, tags: string[]): string {
  let out = html
  for (const tag of tags) {
    for (let i = 0; i < 50; i++) {
      const open = new RegExp(`<${tag}(\\s[^>]*?)?\\/?>`, "i").exec(out)
      if (!open) break
      if (open[0].endsWith("/>")) {
        out = out.slice(0, open.index) + out.slice(open.index + open[0].length)
        continue
      }
      const end = oldScanClose(out, open.index + open[0].length, tag)
      if (end > 0) out = out.slice(0, open.index) + out.slice(end)
      else out = out.slice(0, open.index) + out.slice(open.index + open[0].length)
    }
  }
  return out
}

const OLD_BOILERPLATE_RE =
  /(article[-_]?header|post[-_]?header|entry[-_]?header|page[-_]?header|share|related|recommend|comment|sidebar|breadcrumb|pagination|advert|sns|social[-_]?link|copyright|license|qrcode|qr[-_]?code|author[-_]?card|author[-_]?box|popup|modal|toast|paywall|subscribe[-_]?box|newsletter)/i

function oldRemoveBoilerplateScan(html: string): string {
  const re = /<(div|section)(\s[^>]*?)?>/gi
  const ranges: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[2] ?? ""
    const cls = /\b(?:class|id)\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? ""
    if (!OLD_BOILERPLATE_RE.test(cls)) continue
    const end = oldScanClose(html, m.index + m[0].length, m[1].toLowerCase())
    if (end > 0) {
      ranges.push([m.index, end])
      re.lastIndex = end
    }
  }
  let out = html
  for (let i = ranges.length - 1; i >= 0; i--) {
    out = out.slice(0, ranges[i][0]) + out.slice(ranges[i][1])
  }
  return out
}

function oldDecodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

// ---------- 测试文档构造 ----------

const TAGS = ["script", "style", "noscript", "template", "svg", "iframe", "form", "button", "select", "nav"]

/** 构造带噪声的文章页：script 内含 "</div>" 字样、嵌套 nav、boilerplate div、懒加载图、相对链接、实体 */
function buildDoc(scriptCount: number, paraCount: number): string {
  const parts: string[] = ["<html><head><style>body{color:red}</style>"]
  for (let i = 0; i < scriptCount; i++) {
    parts.push(`<script>var x${i} = "</div><p>${i}";</script>`)
  }
  parts.push("</head><body>")
  parts.push('<nav class="site-nav"><ul><li><a href="/">Home</a></li></ul></nav>')
  parts.push('<div class="article-header">Header stuff <span class="breadcrumbs">a&gt;b</span></div>')
  parts.push("<article><h1>Test Title</h1>")
  for (let i = 0; i < paraCount; i++) {
    parts.push(`<p>Paragraph ${i} with <a href="/rel/${i}">link ${i}</a> &amp; entity &#x4e2d;&#25991; &nbsp;text.</p>`)
    if (i % 20 === 0) parts.push(`<div class="related-posts">related ${i}</div>`)
    if (i % 25 === 0) parts.push(`<section class="comment-box">comment ${i}</section>`)
    if (i % 50 === 0) {
      parts.push('<img src="/img/lazy.jpg" data-src="/img/real.jpg" alt="pic">')
      parts.push("<img data-src=\"https://cdn.example.com/x.jpg\">")
    }
  }
  parts.push("</article>")
  parts.push('<div class="sidebar">sidebar text here</div>')
  parts.push('<footer class="copyright">2026</footer>')
  parts.push("</body></html>")
  return parts.join("")
}

const docSmall = buildDoc(30, 100)
const nestedDoc =
  "<html><body><nav><nav><p>deep nav</p></nav><div class=\"sidebar\">x</div></nav>" +
  "<article><h1>T</h1><h1>dup</h1><script>var a = \"</nav>\";</script><p>body &amp; text</p>" +
  "<section class=\"recommend\"><div><div>deep</div></div></section></article></body></html>"
const doc60Scripts = buildDoc(60, 8) // 旧实现对每标签最多删 50 块

// ---------- 断言工具 ----------

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass++
  else failures.push(label)
  lines.push((ok ? "[PASS] " : "[FAIL] ") + label + (detail ? "  | " + detail : ""))
}
function assertEq(label: string, actual: any, expected: any) {
  const ok = actual === expected
  check(label, ok, ok ? undefined : `actual=${JSON.stringify(String(actual).slice(0, 120))} expected=${JSON.stringify(String(expected).slice(0, 120))}`)
}
function timeMs(fn: () => unknown, iters = 3): { min: number; avg: number } {
  fn() // warmup
  const ts: number[] = []
  for (let i = 0; i < iters; i++) {
    const t0 = Date.now()
    fn()
    ts.push(Date.now() - t0)
  }
  return { min: Math.min(...ts), avg: ts.reduce((a, b) => a + b, 0) / ts.length }
}

// ---------- 主流程 ----------

try {
  // 1. removeTagBlocks：新旧输出逐字节等价
  const eqDocs: [string, string][] = [
    ["常规文档(30 script/100 段)", docSmall],
    ["嵌套标签+script含闭合串", nestedDoc],
  ]
  for (const [name, doc] of eqDocs) {
    assertEq(`removeTagBlocks 等价: ${name}`, removeTagBlocks(doc, TAGS), oldRemoveTagBlocks(doc, TAGS))
  }
  // 2. removeBoilerplateScan 等价
  for (const [name, doc] of eqDocs) {
    assertEq(`removeBoilerplateScan 等价: ${name}`, removeBoilerplateScan(doc), oldRemoveBoilerplateScan(doc))
  }
  // 3. 60 个 script：旧实现受 50 上限残留 10 个，新实现应全部删除（预期差异，非等价用例）
  const n60 = removeTagBlocks(doc60Scripts, TAGS)
  const o60 = oldRemoveTagBlocks(doc60Scripts, TAGS)
  check("60-script: 新实现无 script 残留", !/<script/i.test(n60), `residual=${(n60.match(/<script/gi) ?? []).length}`)
  check("60-script: 旧实现残留≈10（上限行为对照）", (o60.match(/<script/gi) ?? []).length === 10)

  // 4. decodeEntities：新旧等价 + 具体期望值
  const battery: [string, string][] = [
    ["", ""],
    ["plain text", "plain text"],
    ["&#65;&#x42;", "AB"],
    ["&#x4e2d;&#20013;", "中中"],
    ["&quot;x&quot;", '"x"'],
    ["&apos;a&apos;", "'a'"],
    ["&lt;i&gt;", "<i>"],
    ["&nbsp;", " "],
    ["&amp;lt;", "&lt;"], // 双转义只解一层
    ["&copy;", "&copy;"], // 白名单外实体不处理（同旧行为）
    ["a & b", "a & b"],
    ["a<![CDATA[X & Y]]>b", "aX & Yb"],
  ]
  for (const [input, expected] of battery) {
    assertEq(`decodeEntities ${JSON.stringify(input)}`, decodeEntities(input), oldDecodeEntities(input))
    assertEq(`decodeEntities 期望值 ${JSON.stringify(input)}`, decodeEntities(input), expected)
  }
  // 非法码点：旧实现 String.fromCodePoint 越界会直接抛 RangeError，新实现保留原文
  assertEq("decodeEntities 越界码点不崩溃且保留原文", decodeEntities("&#99999999;"), "&#99999999;")

  // 5. parseFeed 端到端（实体/CDATA/guid/日期）
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Sample &amp; Feed</title>
<link>https://example.com</link>
<item><title>Post &#x4e2d;&#25991; &quot;q&quot;</title><link>https://example.com/a</link>
<description><![CDATA[<p>hello &amp; <b>world</b></p>]]></description>
<pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><guid>g1</guid></item>
<itemskip/><item><title>Second</title><link>https://example.com/b</link>
<description>plain &amp; summary</description><guid>g2</guid></item>
</channel></rss>`
  const pf = parseFeed(xml)
  assertEq("parseFeed: 频道标题实体解码", pf.title, "Sample & Feed")
  assertEq("parseFeed: 条目数", pf.articles.length, 2)
  assertEq("parseFeed: 条目标题", pf.articles[0].title, "Post 中文 \"q\"")
  assertEq("parseFeed: CDATA 内容", pf.articles[0].content, "<p>hello & <b>world</b></p>")
  assertEq("parseFeed: guid", pf.articles[0].guid, "g1")
  check("parseFeed: 日期解析", pf.articles[0].date > 0, String(pf.articles[0].date))

  // 6. extractArticle 端到端 sanity
  const ex = extractArticle(docSmall, "https://example.com/a/b.html")
  check("extractArticle: 提取到正文（无 script/style）", ex.includes("Paragraph 50") && !/<script|<style|<nav/i.test(ex))
  check("extractArticle: 懒加载图修复", ex.includes('src="https://cdn.example.com/x.jpg"') && ex.includes('src="https://example.com/img/lazy.jpg"') && ex.includes('data-src="https://cdn.example.com/x.jpg"') === false, ex.slice(0, 200))

  // 7. capArticles：copy-on-write + starred 保留
  const many: Article[] = []
  for (let i = 0; i < 320; i++) many.push({ id: "id" + i, feedUrl: "f", feedTitle: "F", title: "t" + i, link: "l" + i, content: "c" + i, date: Date.now() - i * 60_000 })
  for (let i = 0; i < 5; i++) many.push({ id: "old-star" + i, feedUrl: "f", feedTitle: "F", title: "s" + i, link: "ls" + i, content: "cs" + i, date: Date.now() - (1000 + i) * 60_000, starred: true })
  const firstRef = many[0]
  const inputLen = many.length
  const capped = capArticles(many)
  check("capArticles: 输入数组未被原地排序/截断（copy-on-write）", many[0] === firstRef && many.length === inputLen)
  check("capArticles: 返回新数组", capped !== many)
  check("capArticles: 星标全部保留", capped.filter((a: Article) => a.starred).length === 5)
  check("capArticles: 长度 = 300 + 5 星标", capped.length === 305, String(capped.length))
  check("capArticles: 按日期降序", capped.every((a: Article, i: number) => i === 0 || capped[i - 1].date >= a.date))

  // 8. 耗时对比（约 0.5MB 文档；旧实现受 50 块上限但仍是逐块全串拷贝）
  const bigDoc = buildDoc(500, 3000)
  const bOld = timeMs(() => oldRemoveTagBlocks(bigDoc, TAGS))
  const bNew = timeMs(() => removeTagBlocks(bigDoc, TAGS))
  const cOld = timeMs(() => oldRemoveBoilerplateScan(bigDoc))
  const cNew = timeMs(() => removeBoilerplateScan(bigDoc))
  const eNew = timeMs(() => extractArticle(bigDoc, "https://example.com/a/b.html"))
  lines.push(`[TIME] removeTagBlocks(${(bigDoc.length / 1024).toFixed(0)}KB): old=${bOld.min.toFixed(1)}ms new=${bNew.min.toFixed(1)}ms (min of 3)`)
  lines.push(`[TIME] removeBoilerplateScan: old=${cOld.min.toFixed(1)}ms new=${cNew.min.toFixed(1)}ms (min of 3)`)
  lines.push(`[TIME] extractArticle 全管线(新): ${eNew.min.toFixed(1)}ms (min of 3)`)
} catch (err: any) {
  lines.push("[EXCEPTION] " + String(err?.stack ?? err))
}

lines.push(`SUMMARY: pass=${pass} fail=${failures.length}`)
if (failures.length) lines.push("FAILED: " + failures.join(" ; "))
lines.push("@ " + new Date().toISOString())

const RESULT_PATH =
  FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/perf-verify-result.txt"
FileManager.writeAsStringSync(RESULT_PATH, lines.join("\n") + "\n")