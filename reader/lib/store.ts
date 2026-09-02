// lib/store.ts — 订阅源与文章缓存，存 App Group 目录（小组件可读）

import { fetchFeed } from "./rss"
import type { DarkReadTheme } from "./util"
import { DEFAULT_GESTURES, mergeGestures } from "./gestures"
import type { GestureMap } from "./gestures"

export interface Feed {
  url: string
  title: string
  /** 用户自定义名称（长按重命名），优先于抓取的 title 显示 */
  customTitle?: string
  siteUrl: string
  addedAt: number
}

export interface Article {
  /** 稳定 ID：feedUrl + guid 的散列 */
  id: string
  feedUrl: string
  feedTitle: string
  title: string
  link: string
  content: string
  /** 抓取的全文（源只给摘要时按需加载并缓存） */
  fulltext?: string
  /** 源本身就提供全文（Atom content / content:encoded），无需再抓 */
  fullContent?: boolean
  date: number
  author?: string
  read?: boolean
  starred?: boolean
}

const DIR = FileManager.appGroupDocumentsDirectory + "/reader"
const FEEDS_FILE = DIR + "/feeds.json"
const ARTICLES_FILE = DIR + "/articles.json"
const MAX_ARTICLES = 300

// 进程内缓存：load* 首次读盘后命中内存，save* 同步更新缓存。
// 消除 UI 层渲染期/广播时的重复读盘与全量 JSON.parse（articles.json 含 HTML 字段，体积大）。
// 注意：仅在同一进程内一致；小组件是独立进程，各自读盘，互不影响。
let feedsCache: Feed[] | null = null
let articlesCache: Article[] | null = null

// 写盘合并：已读/收藏/存全文这类单条目变更只改内存缓存，800ms 内的多次改动合并成一次落盘。
// articles.json 含全部正文 HTML，全量序列化+写盘是 MB 级操作，逐次写会造成列表滚动/翻页卡顿。
// flushArticles() 由 index.tsx 在退出前调用，冲刷未落盘状态。
let articlesDirty = false
let flushTimer: any = null
const FLUSH_DELAY = 800

const DEFAULT_FEEDS: Feed[] = [
  { url: "https://sspai.com/feed", title: "少数派", siteUrl: "https://sspai.com", addedAt: 0 },
  { url: "https://www.v2ex.com/index.xml", title: "V2EX", siteUrl: "https://www.v2ex.com", addedAt: 0 },
  { url: "https://hnrss.org/frontpage", title: "Hacker News", siteUrl: "https://news.ycombinator.com", addedAt: 0 },
]

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function ensureDir() {
  if (!FileManager.existsSync(DIR)) FileManager.createDirectorySync(DIR, true)
}

// ---------- 订阅源 ----------

export function loadFeeds(): Feed[] {
  if (feedsCache) return feedsCache
  ensureDir()
  if (!FileManager.existsSync(FEEDS_FILE)) {
    saveFeeds(DEFAULT_FEEDS)
    return feedsCache!
  }
  try {
    feedsCache = JSON.parse(FileManager.readAsStringSync(FEEDS_FILE))
  } catch {
    feedsCache = []
  }
  return feedsCache!
}

export function saveFeeds(feeds: Feed[]) {
  ensureDir()
  feedsCache = [...feeds]
  FileManager.writeAsStringSync(FEEDS_FILE, JSON.stringify(feeds, null, 2))
}

export async function addFeed(url: string): Promise<Feed> {
  url = url.trim()
  if (!/^https?:\/\//i.test(url)) url = "https://" + url
  const feeds = loadFeeds()
  if (feeds.some(f => f.url === url)) throw new Error("该订阅源已存在")
  const parsed = await fetchFeed(url)
  const feed: Feed = { url, title: parsed.title, siteUrl: parsed.siteUrl, addedAt: Date.now() }
  feeds.push(feed)
  saveFeeds(feeds)
  return feed
}

export function removeFeed(url: string) {
  saveFeeds(loadFeeds().filter(f => f.url !== url))
  saveArticles(loadArticles().filter(a => a.feedUrl !== url))
}

/** 订阅源显示名：自定义名优先 */
export function feedDisplayTitle(f: Feed): string {
  return f.customTitle ?? f.title
}

/**
 * 重命名订阅源。传入空串或与源标题相同 = 清除自定义名。
 * 同步改写该源已缓存文章的 feedTitle，使文章列表/小组件的来源名一致。
 */
export function renameFeed(url: string, name: string) {
  const feeds = loadFeeds()
  const feed = feeds.find(f => f.url === url)
  if (!feed) return
  const trimmed = name.trim()
  if (trimmed && trimmed !== feed.title) feed.customTitle = trimmed
  else delete feed.customTitle
  saveFeeds(feeds)
  const display = feedDisplayTitle(feed)
  const articles = loadArticles()
  let touched = false
  for (const a of articles) {
    if (a.feedUrl === url && a.feedTitle !== display) {
      a.feedTitle = display
      touched = true
    }
  }
  if (touched) touchArticles()
}

// ---------- 应用设置（settings.json，小文件直接同步读写） ----------

export interface AppSettings {
  /** 深色模式下文章阅读页的底色风格 */
  darkReadTheme: DarkReadTheme
  /** 深色模式字体亮度 0.5–1（1 = 原色） */
  darkTextBrightness: number
  /** 深色模式图片亮度 0.4–1（1 = 原图） */
  darkImageBrightness: number
  /** 文章阅读页手势 → 动作映射（lib/gestures.ts 注册表，动作可扩展） */
  gestures: GestureMap
  /** 换文/换全文的翻页动画：无 / 淡入 / 横向滑入（仅新页滑入，方向随切换方向） */
  pageTransition: PageTransition
  /** 已读标记：点进文章（含手势换文）时自动标已读 */
  markReadOnOpen: boolean
  /** 已读标记：列表向下滑、文章行滚出屏幕顶部时自动标已读 */
  markReadOnScroll: boolean
}

/** 翻页动画选项（articleHtml prefs.transition 的可选值 + none） */
export type PageTransition = "none" | "fade" | "slide"
export const PAGE_TRANSITIONS: PageTransition[] = ["none", "fade", "slide"]
export const PAGE_TRANSITION_LABELS: Record<PageTransition, string> = { none: "无", fade: "淡入", slide: "横向滑动" }

const SETTINGS_FILE = DIR + "/settings.json"
const DEFAULT_SETTINGS: AppSettings = { darkReadTheme: "ink", darkTextBrightness: 1, darkImageBrightness: 1, gestures: DEFAULT_GESTURES, pageTransition: "fade", markReadOnOpen: true, markReadOnScroll: false }
let settingsCache: AppSettings | null = null

export function loadSettings(): AppSettings {
  if (!settingsCache) {
    ensureDir()
    let s: Partial<AppSettings> = {}
    if (FileManager.existsSync(SETTINGS_FILE)) {
      try { s = JSON.parse(FileManager.readAsStringSync(SETTINGS_FILE)) ?? {} } catch { s = {} }
    }
    const pt = (s as any).pageTransition
    settingsCache = {
      ...DEFAULT_SETTINGS, ...s,
      gestures: mergeGestures((s as any).gestures),
      pageTransition: PAGE_TRANSITIONS.includes(pt) ? pt : DEFAULT_SETTINGS.pageTransition,
      markReadOnOpen: typeof (s as any).markReadOnOpen === "boolean" ? (s as any).markReadOnOpen : DEFAULT_SETTINGS.markReadOnOpen,
      markReadOnScroll: typeof (s as any).markReadOnScroll === "boolean" ? (s as any).markReadOnScroll : DEFAULT_SETTINGS.markReadOnScroll,
    }
  }
  return settingsCache
}

export function saveSettings(s: AppSettings) {
  settingsCache = { ...s }
  ensureDir()
  FileManager.writeAsStringSync(SETTINGS_FILE, JSON.stringify(s))
}

// ---------- 文章 ----------

export function loadArticles(): Article[] {
  if (articlesCache) return articlesCache
  ensureDir()
  if (!FileManager.existsSync(ARTICLES_FILE)) {
    articlesCache = []
    return articlesCache
  }
  try {
    articlesCache = JSON.parse(FileManager.readAsStringSync(ARTICLES_FILE))
  } catch {
    articlesCache = []
  }
  return articlesCache!
}

/** 截断到上限：copy-on-write（不动入参数组），starred 不因日期靠后被挤出 */
export function capArticles(articles: Article[]): Article[] {
  const sorted = [...articles].sort((a, b) => b.date - a.date)
  const kept: Article[] = []
  let quota = MAX_ARTICLES
  for (const a of sorted) {
    if (a.starred || quota > 0) {
      kept.push(a)
      if (!a.starred) quota--
    }
  }
  return kept
}

function writeArticles(list: Article[]) {
  ensureDir()
  articlesDirty = false
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  FileManager.writeAsStringSync(ARTICLES_FILE, JSON.stringify(list))
}

/** 单条目变更（已读/收藏/全文）：换缓存数组身份（同引用 setState 会被跳过）+ 合并延迟落盘 */
function touchArticles() {
  articlesDirty = true
  articlesCache = articlesCache!.slice()
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (articlesDirty && articlesCache) writeArticles(articlesCache)
  }, FLUSH_DELAY)
}

/** 立即冲刷未落盘的变更（退出/最小化前调用） */
export function flushArticles() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (articlesDirty && articlesCache) writeArticles(articlesCache)
}

export function saveArticles(articles: Article[]) {
  ensureDir()
  const kept = capArticles(articles)
  articlesCache = kept
  writeArticles(kept)
}

/** 标记已读，返回是否真的发生了变更（供调用方决定是否广播） */
export function markRead(id: string): boolean {
  const a = loadArticles().find(x => x.id === id)
  if (a && !a.read) {
    a.read = true
    touchArticles()
    return true
  }
  return false
}

export function toggleStar(id: string) {
  const a = loadArticles().find(x => x.id === id)
  if (a) {
    a.starred = !a.starred
    touchArticles()
  }
}

export function saveFulltext(id: string, html: string) {
  const a = loadArticles().find(x => x.id === id)
  if (a) {
    a.fulltext = html
    touchArticles()
  }
}

export function unreadCount(): number {
  return loadArticles().filter(a => !a.read).length
}

// ---------- 刷新 ----------

export interface RefreshResult {
  added: number
  errors: { feed: string; error: string }[]
}

/** 抓取全部订阅源，合并新文章（保留已读/收藏状态） */
export async function refreshAll(): Promise<RefreshResult> {
  const feeds = loadFeeds()
  const old = loadArticles()
  const oldById = new Map(old.map(a => [a.id, a]))
  const errors: RefreshResult["errors"] = []
  let added = 0
  // 无变化时不写盘：原先无条件 saveFeeds+saveArticles，每次下拉刷新都全量重写两份文件
  let feedsChanged = false
  let articlesChanged = false

  const results = await Promise.allSettled(feeds.map(f => fetchFeed(f.url)))

  const merged = new Map(oldById)
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      errors.push({ feed: feeds[i].title, error: String(r.reason?.message ?? r.reason) })
      return
    }
    const parsed = r.value
    // 更新订阅源标题（首次抓取后可能有变化）
    if (parsed.title && feeds[i].title !== parsed.title) {
      feeds[i].title = parsed.title
      feeds[i].siteUrl = parsed.siteUrl || feeds[i].siteUrl
      feedsChanged = true
    }
    for (const p of parsed.articles.slice(0, 30)) {
      const id = hash(feeds[i].url + "|" + p.guid)
      const cur = merged.get(id)
      if (!cur) {
        merged.set(id, {
          id,
          feedUrl: feeds[i].url,
          feedTitle: feeds[i].customTitle ?? parsed.title ?? feeds[i].title,
          title: p.title,
          link: p.link,
          content: p.content,
          fullContent: p.fullContent,
          date: p.date || Date.now(),
          author: p.author,
        })
        added++
        articlesChanged = true
      } else if (p.fullContent && !cur.fullContent) {
        // 老缓存文章回填全文标记
        cur.fullContent = true
        articlesChanged = true
      }
    }
  })

  if (feedsChanged) saveFeeds(feeds)
  if (articlesChanged) saveArticles([...merged.values()])
  return { added, errors }
}
