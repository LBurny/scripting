// views/ArticleView.tsx — 文章阅读页
// 布局对齐常见 RSS App：系统返回键在导航栏左，收藏/加载全文/Safari 图标排在导航栏右
// （不要文字只要图标）；标题与来源、时间渲染进正文 HTML 头部。
// 手势（lib/gestures.ts）：正文 WKWebView 内页面 JS 识别 双击/左滑/右滑，
// 经 messageHandlers.readerGesture 回传本页，按 AppSettings.gestures 映射执行——
// 双击退出（弹栈）、左右滑原位换上/下一篇（不压新页，系统返回键仍回原列表）。
//
// 白屏修复（2026-09-01 第二轮真机修）：换文/换全文【不再】走 hidden 隐藏周期——
// WKWebView 在新内容 commit 前本就一直显示旧页，无需遮罩；曾用的「置 ready=false
// 隐藏 → loadHTML → 置回 true」链路在真机上「藏而不揭」（loadHTML promise 不兑现
// 或 hidden 属性更新被运行时丢弃），滑动后永久白屏。首屏初次加载的 hidden 机制保留
// （ready 仅 false→true 单次转换，真机验证可靠）。
// 诊断：手势全链路 trace 写 App Group reader/gesture-trace.log（msg→action→switch→loadHTML）。

import {
  VStack, Text, Button, Image, WebView, Toolbar, ToolbarItem,
  useState, useEffect, useRef,
  Navigation,
} from "scripting"
import { Article, markRead, toggleStar, loadArticles, saveFulltext, loadSettings, AppSettings } from "../lib/store"
import type { GestureActionId } from "../lib/gestures"
import { emitDataChanged } from "../lib/bus"
import { articleHtml, DARK_THEMES } from "../lib/util"
import { fetchFullText } from "../lib/fulltext"

function plainLen(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length
}

// ---------- 真机诊断 trace（手势链路排障；量极小：每手势一次消息 + 切篇几步） ----------
const TRACE_FILE = FileManager.appGroupDocumentsDirectory + "/reader/gesture-trace.log"
function trace(line: string) {
  try {
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, "0")
    const ts = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
    FileManager.appendTextSync(TRACE_FILE, `${ts} ${line}\n`)
  } catch {}
}

/** 加载正文 HTML；commit 后延迟 60ms 再 onReady（给首屏绘制留一帧时间）。
 *  无论成功失败都会回调 onReady，避免 WebView 永远处于隐藏态。
 *  注意：这里必须显式把 AppSettings 字段映射成 articleHtml 的 prefs 形状，
 *  两边字段名不同（darkReadTheme→theme 等），直接透传会静默全部回退到默认值。
 *  opts.transition/slideFrom：换文/换全文的翻页动画（设置页三选一 none/fade/slide 的现场值，
 *  slide 方向随切换方向）；首期打开不传、不播动画。 */
function renderArticle(c: WebViewController, article: Article, content: string, prefs: AppSettings, onReady: () => void, opts?: { transition?: "fade" | "slide"; slideFrom?: "left" | "right" }) {
  trace(`loadHTML call ${article.id}`)
  // baseURL 传文章链接：让 WebView 请求图片时带上站点 Referer（少数派 CDN 防盗链要求）
  c.loadHTML(
    articleHtml(article, content, {
      theme: prefs.darkReadTheme,
      textBrightness: prefs.darkTextBrightness,
      imageBrightness: prefs.darkImageBrightness,
      transition: opts?.transition,
      slideFrom: opts?.slideFrom,
    }),
    article.link,
  )
    .then(() => { trace(`loadHTML ok ${article.id}`); setTimeout(onReady, 60) })
    .catch((e) => { trace(`loadHTML err ${article.id} ${String(e?.message ?? e)}`); onReady() })
}

/** 导航栏纯图标按钮：字号/颜色对齐系统返回键（body + 系统蓝），34pt 宽占位拉开间距 */
function ActionIcon({ name, label, color, disabled, spinning, action }: {
  name: string
  label: string
  /** 默认系统蓝（与返回键同色）；收藏态可传 systemOrange */
  color?: string
  disabled?: boolean
  /** 加载中：value 递增触发 rotateClockwise 离散动效 */
  spinning?: number
  action: () => void
}) {
  return (
    <Button action={action} buttonStyle="plain" accessibilityLabel={label} disabled={disabled}>
      <Image
        systemName={name}
        font="body"
        foregroundStyle={(color ?? "systemBlue") as any}
        frame={{ width: 34 }}
        {...(spinning !== undefined ? { symbolEffect: { effect: "rotateClockwise", value: spinning } as any } : {})}
      />
    </Button>
  )
}

export function ArticleView({ article, playlist, previewPlaceholder }: {
  article: Article
  /** 打开列表Tab的文章顺序快照（手势换文的相邻行依据）；无列表上下文入口可不传 */
  playlist?: string[]
  previewPlaceholder?: boolean
}) {
  // 初始化器一次算好：存储里的最新快照 + 初始全文，避免挂载后 setState 引发首帧重建
  const [initial] = useState(() => {
    const fresh = loadArticles().find(x => x.id === article.id)
    const a: Article = { ...article, ...(fresh ?? {}), starred: !!(fresh?.starred ?? article.starred), read: loadSettings().markReadOnOpen ? true : !!(fresh?.read ?? article.read) }
    return { article: a, fulltext: fresh?.fulltext ?? article.fulltext ?? null }
  })
  // 当前文章（手势换文时原位替换）；本页其余状态全部跟随 cur
  const [cur, setCur] = useState<Article>(() => initial.article)
  const [starred, setStarred] = useState(!!initial.article.starred)
  const [fullHtml, setFullHtml] = useState<string | null>(initial.fulltext)
  const [loadingFull, setLoadingFull] = useState(false)
  const [fullError, setFullError] = useState<string | null>(null)
  // 深色阅读偏好（设置页可选：底色风格 + 字体/图片亮度），
  // 在 controller 之前读取，创建瞬间的首批 load 即用
  const [prefs] = useState<AppSettings>(() => loadSettings())
  const [ready, setReady] = useState(false)
  // 当前文章的可变引用（原位换文/换文中的抓取都以它判定「现在是谁」）；
  // 抓取完成时若已换到别篇则只写缓存不动 UI；连续换文时 loadHTML 顺序提交、最后一次生效。
  const curRef = useRef<Article>(initial.article)
  // 手势消息 handler 只注册一次，经此 ref 分发到最新闭包（读最新 state/refs）
  const gestureRef = useRef<(t: string) => void>(() => {})
  // 闪白修复：创建瞬间直接排队加载正式正文（不等 useEffect），WebView 隐藏到
  // 内容 commit + 60ms 首屏绘制后揭开（仅此一次 false→true；换文不再动 ready）
  const [controller] = useState(() => {
    const c = new WebViewController()
    if (!previewPlaceholder) {
      // 手势消息端口必须先注册再 loadHTML；页面要等 commit 后才有触摸，无竞态
      c.addScriptMessageHandler("readerGesture", (msg: any) => {
        try { trace(`msg ${typeof msg === "string" ? msg : JSON.stringify(msg)}`) } catch {}
        let t = ""
        try {
          const p = typeof msg === "string" ? JSON.parse(msg) : msg
          t = typeof p?.t === "string" ? p.t : ""
        } catch {}
        gestureRef.current(t)
      })
        .catch(() => {})
        .then(() => renderArticle(c, initial.article, initial.fulltext ?? initial.article.content, prefs, () => setReady(true)))
    }
    return c
  })
  // 手势「退出文章」：在压栈页内 dismiss 即 pop 回列表
  const dismiss = Navigation.useDismiss()

  /** 渲染某篇文章的正文。不做任何隐藏——WKWebView 在新内容 commit 前会一直
   *  显示旧页，天然无白隙；曾用的 hidden 周期在真机上藏而不揭（白屏根因）。
   *  翻页动画按设置现场值（none/fade/slide；slide 时新页从 slideFrom 侧滑入），
   *  首期打开不播。 */
  const applyPage = (a: Article, content: string, slideFrom?: "left" | "right") => {
    const pt = loadSettings().pageTransition
    renderArticle(controller, a, content, prefs, () => {},
      pt === "none" ? undefined : { transition: pt, slideFrom })
  }

  const loadFull = async (a: Article = cur) => {
    setLoadingFull(true)
    setFullError(null)
    try {
      const html = await fetchFullText(a.link)
      saveFulltext(a.id, html)
      // 抓取期间用户已手势换到别篇？只写缓存不动 UI
      if (curRef.current.id !== a.id) return
      setFullHtml(html)
      // 换全文从右侧滑入（内容变深的方向感；slide 模式时）
      applyPage(a, html, "right")
    } catch (e: any) {
      if (curRef.current.id === a.id) {
        const msg = String(e?.message ?? e)
        setFullError(/abort/i.test(msg) ? "请求超时（网络不佳或站点响应慢）" : msg)
      }
    } finally {
      setLoadingFull(false)
    }
  }

  /** 原位换文：step=-1 上一篇（列表上一行，较新），+1 下一篇（下一行，较旧）。
   *  把本页全部「当前文章」状态换成相邻文章并重渲染正文，不压新导航页。 */
  const switchTo = (step: 1 | -1) => {
    const all = loadArticles()
    // 有列表上下文且当前篇仍在其中则沿用（保持进入列表的过滤顺序），否则按全文时间序兜底
    const ids = (playlist && playlist.length && playlist.includes(curRef.current.id))
      ? playlist
      : all.map(a => a.id)
    const i = ids.indexOf(curRef.current.id)
    if (i < 0) { trace(`switch step=${step} abort: cur not in ids`) ; return }
    const targetId = ids[i + step]
    if (!targetId) { trace(`switch step=${step} boundary i=${i}/${ids.length}`); return } // 已在列表头/尾：静默
    const target = all.find(x => x.id === targetId)
    if (!target) { trace(`switch step=${step} target missing ${targetId}`); return }
    trace(`switch step=${step} i=${i}/${ids.length} -> ${target.id} ${target.title.slice(0, 24)}`)
    curRef.current = target
    setCur(target)
    setStarred(!!target.starred)
    setFullHtml(target.fulltext ?? null)
    setFullError(null)
    // 设置页「进入文章时标记已读」（手势换文也算进入）：关掉则保持未读
    if (loadSettings().markReadOnOpen) markRead(target.id)
    // 摘要源且极短自动抓全文（与打开文章时同一规则）；否则立即渲染正文
    if (!target.fulltext && !target.fullContent && plainLen(target.content) < 300) {
      setLoadingFull(true)
      loadFull(target)
    } else {
      // 滑动方向 = 新页入场方向：下一篇（step+1，左滑）从右滑入；上一篇从左滑入
      applyPage(target, target.content, step > 0 ? "right" : "left")
    }
  }

  // 手势消息 → 设置里的动作映射（未知 id 一律视为无操作）
  gestureRef.current = (t: string) => {
    const g = loadSettings().gestures
    const id: GestureActionId = t === "doubleTap" ? g.doubleTap
      : t === "swipeLeft" ? g.swipeLeft
      : t === "swipeRight" ? g.swipeRight
      : "none"
    trace(`action ${t} -> ${id}`)
    if (id === "exit") dismiss()
    else if (id === "prevArticle") switchTo(-1)
    else if (id === "nextArticle") switchTo(1)
  }

  useEffect(() => {
    // 静默标记已读（受设置「进入文章时标记已读」门控），【不要】在这里广播：广播会触发未读列表重载，文章行消失，
    // 推送页被运行时拿旧 prop 快照重建，导航栏按钮仍绑定在已失效的旧实例上
    // ——这就是「点收藏星星不变实心」的根因。改为本页销毁（返回列表）时统一广播一次。
    if (loadSettings().markReadOnOpen) markRead(cur.id)
    // 源只给摘要且太短时才自动抓全文（fullContent 源如 V2EX 本身已是全文，不抓）
    if (!initial.fulltext && !cur.fullContent && plainLen(cur.content) < 300) loadFull(cur)
    // 返回列表时统一广播：刷新未读点、收藏列表、全文缓存；手势原地换过的文章一并带上已读状态
    return () => emitDataChanged()
  }, [])

  const [spin, setSpin] = useState(0)

  // 加载全文时推进 spin，驱动图标旋转（无 setInterval，递归 setTimeout）
  useEffect(() => {
    if (!loadingFull) return
    let alive = true
    const loop = () => { if (alive) { setSpin(s => s + 1); setTimeout(loop, 450) } }
    loop()
    return () => { alive = false }
  }, [loadingFull])

  // 视觉顺序（左→右）：加载全文 → 收藏 → Safari
  // iOS topBarTrailing 先声明的靠最右，故声明顺序与视觉顺序相反
  const toolbar = (
    // key 随收藏状态变化：强制运行时重建导航栏图标（推送页 toolbar 疑似不随 state 刷新）
    <Toolbar key={starred ? "starred" : "plain"}>
      {/* Safari 打开（最右） */}
      <ToolbarItem placement="topBarTrailing">
        <ActionIcon
          name="safari"
          label="Safari 打开"
          action={() => Safari.openURL(cur.link)}
        />
      </ToolbarItem>
      {/* 收藏（中间）：已收藏实心星，颜色与返回键一致 */}
      <ToolbarItem placement="topBarTrailing">
        <ActionIcon
          name={starred ? "star.fill" : "star"}
          label={starred ? "取消收藏" : "收藏"}
          action={() => {
            toggleStar(cur.id)
            const fresh = loadArticles().find(x => x.id === cur.id)
            setStarred(!!fresh?.starred)
            // 不广播：避免本页被重建；返回列表时统一刷新
          }}
        />
      </ToolbarItem>
      {/* 加载全文（最左）：常驻显示；已加载过时再次点击 = 重新抓取 */}
      <ToolbarItem placement="topBarTrailing">
        <ActionIcon
          name={loadingFull ? "circle.dotted" : fullHtml ? "doc.text.fill" : "doc.text"}
          label={fullHtml ? "重新加载全文" : "加载全文"}
          disabled={loadingFull}
          spinning={loadingFull ? spin : undefined}
          action={() => loadFull(cur)}
        />
      </ToolbarItem>
    </Toolbar>
  )

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toolbar={toolbar}
      // WebView 隐藏期间露出的页面底色：必须与正文 HTML body 底色完全一致，
      // 否则揭开隐藏的瞬间会有色差跳动。深色取所选阅读风格的底色。
      // 用 DynamicShapeStyle {light, dark} 自适应（全局 colorScheme 文档声称存在，
      // 运行时实为 undefined，引用会 ReferenceError 导致整页构建失败——已实测）
      background={{ style: { light: "#ffffff", dark: DARK_THEMES[prefs.darkReadTheme].bg }, shape: "rect" }}
    >
      {/* 分隔线：导航栏下缘，正文滚动到此裁剪（同 TabPage 方案） */}
      <VStack frame={{ maxWidth: "infinity", height: 0.5 }} background={{ style: "separator", shape: "rect" }} />
      {fullError ? (
        <Text font={12} foregroundStyle="systemRed" padding={{ leading: 16, trailing: 16, top: 6 }}>
          全文加载失败：{fullError}
        </Text>
      ) : null}
      {/* 正文（标题/来源/时间在 HTML 头部）。
          初次加载 hidden 期间仍占布局空间、正常加载；内容 commit 后才可见，白底无机会露出。
          换文/换全文不再隐藏（WKWebView commit 前自留旧页）。 */}
      {previewPlaceholder ? (
        <VStack frame={{ maxHeight: "infinity" }} background={{ style: "rgba(128,128,128,0.14)", shape: "rect" }} padding={16} alignment="leading">
          <Text font={14} foregroundStyle="secondaryLabel">[正文 WebView 区域]</Text>
        </VStack>
      ) : (
        <WebView
          controller={controller}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          hidden={!ready}
        />
      )}
    </VStack>
  )
}
