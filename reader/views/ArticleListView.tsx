// views/ArticleListView.tsx — 文章流（全部 / 未读 / 收藏 三个 Tab 共用）
// 滚动容器用 ScrollView + LazyVStack(scrollTargetLayout)，【不用 List】：
// 划过已读靠 onScrollTargetVisibilityChange 上报可见行 id 集合，而该运行时的
// List 不支持任何滚动目标回调（scroll-probe 实测：List 的 scrollPosition 读回恒空、
// visibility 回调只报空数组；ScrollView+LazyVStack+scrollTargetLayout 精确上报可见 id）。
// 行视觉自绘贴近原 List plain 样式：整行可点 + 0.5pt 缩进分隔线 + 右侧 chevron。
//
// 【已读灭灯不走父级 children diff】真机实测：父组件 setArticles 后，LazyVStack
// 已有子节点的属性更新不生效（蓝点不灭）。改为行内自持 tick（readBus 通知 → 行
// 自己 setState 重渲染，该路径可靠：Toggle/spin 动效同源），article 对象被 store
// 原地改读过（markRead 就地赋值），重渲染即读到新值。
// 防御性设计：LazyVStack 挂 key（列表头 id + 行数），结构性变化（首载/刷新/未读减少）
// 强制整树重建，不依赖运行时对已有子节点的增删 diff。

import {
  ScrollView, LazyVStack, NavigationLink, VStack, HStack, Text, Image, Spacer,
  useState, useEffect, useRef,
} from "scripting"
import { Article, loadArticles, refreshAll, loadSettings, markRead } from "../lib/store"
import { onDataChanged, emitDataChanged } from "../lib/bus"
import { relativeTime } from "../lib/util"
import { plainSummary } from "../lib/rss"
import { ArticleView } from "./ArticleView"

export type ArticleFilter = "all" | "unread" | "starred"

const TITLES: Record<ArticleFilter, string> = {
  all: "全部文章",
  unread: "未读",
  starred: "收藏",
}

// ---------- 行级「灭灯」总线 ----------
// ids=null → 全体行重读状态（配合广播重载）；ids=集合 → 仅这些行（划过批量标记）。
// 行订阅后自 setState 重渲染，绕开 LazyVStack 子节点属性更新不生效的运行时缺陷。
type ReadBusHandler = (ids: Set<string> | null) => void
const readBus = new Set<ReadBusHandler>()
function emitReadBus(ids: Set<string> | null) {
  readBus.forEach(h => { try { h(ids) } catch {} })
}

// 摘要记忆化：article.content 不可变（全文缓存存 fulltext 字段，不影响），按 id 缓存。
// 避免每次列表重渲染都对每行 HTML 跑正则剥离。上限 300 条，Map 不会无限增长。
const summaryCache = new Map<string, string>()
function summaryOf(a: Article): string {
  let s = summaryCache.get(a.id)
  if (s === undefined) {
    s = plainSummary(a.content, 80)
    summaryCache.set(a.id, s)
  }
  return s
}

// 行根视图必须是普通容器（VStack）：onScrollTargetVisibilityChange 的 key→.id() 映射
// 作用在组件根节点上，NavigationLink 的 props 是严格联合类型不收 id。
function ArticleRow({ article, playlist }: { article: Article; playlist: string[] }) {
  // 行内 tick：readBus 命中本行即自重渲染（article.read / article.starred 已被
  // store 原地改读，重渲染读到新值 → 蓝点灭、标题字重降、星标出现）。
  const [, setTick] = useState(0)
  useEffect(() => {
    const h: ReadBusHandler = (ids) => { if (ids === null || ids.has(article.id)) setTick(v => v + 1) }
    readBus.add(h)
    return () => { readBus.delete(h) }
  }, [])

  return (
    <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <NavigationLink destination={<ArticleView article={article} playlist={playlist} />} buttonStyle="plain">
        <HStack spacing={8} padding={{ leading: 20, trailing: 16, top: 10, bottom: 10 }} frame={{ maxWidth: "infinity" }}>
          <Image
            systemName="circle.fill"
            font={7}
            foregroundStyle={article.read ? ("clear" as any) : ("systemBlue" as any)}
          />
          <VStack alignment="leading" spacing={3}>
            {/* 标题显式 label 色：NavigationLink 离开 List 环境后默认可能给文本着 accent 色 */}
            <Text font={15} fontWeight={article.read ? "regular" : "semibold"} foregroundStyle="label" lineLimit={2}>
              {article.title}
            </Text>
            <Text font={12} foregroundStyle="secondaryLabel" lineLimit={2}>
              {summaryOf(article)}
            </Text>
            <HStack spacing={6}>
              <Text font={11} foregroundStyle="systemOrange">{article.feedTitle}</Text>
              <Text font={11} foregroundStyle="tertiaryLabel">{relativeTime(article.date)}</Text>
              {article.starred ? (
                <Image systemName="star.fill" font={10} foregroundStyle="systemYellow" />
              ) : null}
            </HStack>
          </VStack>
          <Spacer />
          {/* ScrollView 环境不再自动加披露箭头，自绘贴近原样式 */}
          <Image systemName="chevron.right" font={12} foregroundStyle="tertiaryLabel" />
        </HStack>
      </NavigationLink>
      {/* 分隔线：缩进 36pt 对齐标题起点（蓝点列） */}
      <HStack padding={{ leading: 36 }} frame={{ maxWidth: "infinity" }}>
        <HStack frame={{ maxWidth: "infinity", height: 0.5 }} background={{ style: "separator", shape: "rect" }} />
      </HStack>
    </VStack>
  )
}

// TabView selection 的结构化类型（避免依赖全局 Observable 类型在项目 TSX 可见性）
interface SelectionLike {
  value: number
  subscribe: (cb: (v: number) => void) => void
  unsubscribe: (cb: (v: number) => void) => void
}

export function ArticleListView({ filter, feedUrl, title, selection, tabIndex }: {
  filter: ArticleFilter
  feedUrl?: string
  title?: string
  /** TabView 的 selection（app.tsx 传入）：Tab 重新选中时重载本列表（Tab 常驻不卸载） */
  selection?: SelectionLike
  tabIndex?: number
}) {
  // 首帧同步读缓存（进程内 articlesCache 命中，避免空态闪烁；冷启动时首帧为空、
  // useEffect 读盘后靠 LazyVStack key 变化整树重建）
  const [articles, setArticles] = useState<Article[]>(() => loadArticles())

  useEffect(() => {
    const reload = () => {
      setArticles(loadArticles())
      // 广播重载时通知所有行自读最新 read/starred（store 原地改读，props 引用不变）
      emitReadBus(null)
    }
    if (articles.length === 0) reload()
    const offBus = onDataChanged(reload)
    // Tab 常驻（TabView 不卸载子页）：划过标记是静默的不广播，切回本 Tab 时主动重载，
    // 未读页借此把已标读的行收走（列表行数变化 → structureKey 变 → 整树重建）。
    const onTab = (v: number) => { if (tabIndex !== undefined && v === tabIndex) reload() }
    selection?.subscribe(onTab)
    return () => {
      offBus()
      selection?.unsubscribe(onTab)
    }
  }, [])

  async function handleRefresh() {
    try {
      await refreshAll()
    } catch {}
    emitDataChanged()
  }

  const filtered = articles.filter(a => {
    if (feedUrl && a.feedUrl !== feedUrl) return false
    if (filter === "unread") return !a.read
    if (filter === "starred") return !!a.starred
    return true
  })
  // 手势换文上下文：当前列表 Tab 的文章顺序快照（上/下一篇 = 相邻行）
  const playlist = filtered.map(a => a.id)

  // 划过标记（设置页「划过文章时标记已读」）：visibility 回调给当前可见行 id 集合，
  // 其最小下标 = 顶部（半）可见行；它之前的行已滚过屏幕 → 高水位批量静默 markRead
  // （不广播、800ms 合并落盘）。回滚不撤销；列表头变化（刷新/换 Tab）重置高水位避免误标。
  const filteredRef = useRef<Article[]>([])
  filteredRef.current = filtered
  const idxMapRef = useRef<Map<string, number>>(new Map())
  const idxMap = new Map<string, number>()
  filtered.forEach((a, i) => idxMap.set(a.id, i))
  idxMapRef.current = idxMap
  const scrollMarkRef = useRef({ maxIdx: 0, headId: "" })

  function onVisibleIds(ids: string[] | number[]) {
    if (!ids.length || !loadSettings().markReadOnScroll) return
    const list = filteredRef.current
    if (!list.length) return
    let minIdx = -1
    for (const id of ids) {
      const i = idxMapRef.current.get(String(id))
      if (i !== undefined && (minIdx < 0 || i < minIdx)) minIdx = i
    }
    if (minIdx < 0) return
    const h = scrollMarkRef.current
    if ((list[0]?.id ?? "") !== h.headId) { h.headId = list[0]?.id ?? ""; h.maxIdx = minIdx; return }
    if (minIdx <= h.maxIdx) return
    const marked = new Set<string>()
    for (let i = h.maxIdx; i < minIdx; i++) if (markRead(list[i].id)) marked.add(list[i].id)
    h.maxIdx = minIdx
    // 灭灯走行级总线（三个 Tab 的行都灭点反馈）；未读 Tab 的行不就地消失
    // （避免滚动中列表抽动），切走再回时由 selection 订阅触发重载收走。
    if (marked.size) emitReadBus(marked)
  }

  // 结构 key：列表头 id + 行数。首载/刷新/未读收走时 LazyVStack 整树重建（可靠），
  // 仅已读点亮变化时 key 不变、滚动位置保留，蓝点靠行内 tick 灭掉。
  const structureKey = `${filtered[0]?.id ?? "empty"}:${filtered.length}`

  return (
    <ScrollView
      navigationTitle={title ?? TITLES[filter]}
      navigationBarTitleDisplayMode="inline"
      contentMargins={{ edges: "top" as any, insets: 20 }}
      refreshable={handleRefresh}
      onScrollTargetVisibilityChange={{ idType: "string", threshold: 0.5, onChanged: onVisibleIds } as any}
    >
      <LazyVStack key={structureKey} spacing={0} scrollTargetLayout>
        {filtered.map(a => <ArticleRow key={a.id} article={a} playlist={playlist} />)}
        {filtered.length === 0 ? (
          <VStack key="__empty" spacing={6} padding={{ top: 40, bottom: 40 }} frame={{ maxWidth: "infinity" }}>
            <Image systemName="tray" font={28} foregroundStyle="tertiaryLabel" />
            <Text font={14} foregroundStyle="secondaryLabel">
              {articles.length === 0 ? "正在加载订阅源…" : "这里没有文章"}
            </Text>
          </VStack>
        ) : null}
      </LazyVStack>
    </ScrollView>
  )
}