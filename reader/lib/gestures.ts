// lib/gestures.ts — 手势操作注册表：设置页映射（动作可扩展）+ 文章页注入的识别 JS
//
// 架构：文章正文渲染在 WKWebView 里，原生 gesture 修饰符收不到 WebView 上的触摸
// （UIKit 视图优先消费），故手势在页面 JS 里识别，经 messageHandlers.readerGesture
// 回传原生；ArticleView 注册 handler 后按 AppSettings.gestures 的映射执行动作。
//
// v2（2026-09-01 真机修）：横斜向轻扫会被 WKWebView 原生滚动识别器接管——页面只收
// 得到 touchcancel、永远等不来 touchend，滑动因此全哑（双击不涉及滚动接管所以正常）。
// 修法三件套：① body 触控权 `touch-action: pan-y pinch-zoom`——横向平移让给页面 JS、
// 竖向滚动/捏合缩放仍归原生、双击缩放继续禁用；② 位移过阈值在 touchmove 里**即时触发**
// （不等抬手，抢占管前也能判到）；③ 兜底监听 touchcancel。主方向判定放宽为 1.2 倍。

export type GestureId = "doubleTap" | "swipeLeft" | "swipeRight"
export type GestureActionId = "none" | "exit" | "prevArticle" | "nextArticle"

export type GestureMap = Record<GestureId, GestureActionId>

/** 动作注册表（设置页选项 = 数组顺序；新增动作在这里加 id，labels 加标签，ArticleView 执行分支加一行） */
export const GESTURE_ACTIONS: GestureActionId[] = ["none", "exit", "prevArticle", "nextArticle"]

export const GESTURE_ACTION_LABELS: Record<GestureActionId, string> = {
  none: "无操作",
  exit: "退出文章",
  prevArticle: "上一篇文章",
  nextArticle: "下一篇文章",
}

/** 可配置手势清单（设置页行序）；icon 避开中文系统会本地化成汉字的 SF Symbol */
export const GESTURES: { id: GestureId; label: string; icon: string }[] = [
  { id: "doubleTap", label: "双击", icon: "hand.tap" },
  { id: "swipeLeft", label: "左滑", icon: "chevron.left" },
  { id: "swipeRight", label: "右滑", icon: "chevron.right" },
]

/** 出厂默认（2026-09-01 用户指定）：双击退出；左滑=下一篇（列表下一行，较旧），
 *  右滑=上一篇（上一行，较新）——与 iOS 翻页直觉一致（往左翻出下一篇） */
export const DEFAULT_GESTURES: GestureMap = {
  doubleTap: "exit",
  swipeLeft: "nextArticle",
  swipeRight: "prevArticle",
}

/** 旧版 settings.json 合并：缺失/非法项回退该项出厂默认（未知动作 id 不落库） */
export function mergeGestures(raw: unknown): GestureMap {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<GestureId, unknown>>
  const pick = (id: GestureId): GestureActionId => {
    const v = r[id]
    if (typeof v === "string" && (GESTURE_ACTIONS as string[]).includes(v)) return v as GestureActionId
    return DEFAULT_GESTURES[id]
  }
  return { doubleTap: pick("doubleTap"), swipeLeft: pick("swipeLeft"), swipeRight: pick("swipeRight") }
}

/** 注入文章页的手势识别 JS（ES5 风格、无反引号、无 ${}，可安全嵌进模板字符串）。
 *  v2 判定：
 *  - 滑动：|dx|≥80 且 |dx|>1.2|dy|；dx<0=swipeLeft。在 touchmove 里即时触发（阈值一到
 *    立即上报，不等 touchend——原生滚动接管会吞掉抬手事件）；touchend/touchcancel 再兜底判一次。
 *    pre/input/textarea/select 内不识别滑动（留横向滚动与输入）；竖向滚动 dy 占优永不误触。
 *  - 双击：≤400ms 的轻点，两次落点 <44pt 且间隔 <300ms（起点在 a/button 上不识别）。
 *  命中后经 messageHandlers.readerGesture.postMessage(JSON 字符串) 回传原生；
 *  无 handler 时静默不报错；__readerGestureLoaded 防重入。 */
export const GESTURE_JS = `(function () {
  if (window.__readerGestureLoaded) return
  window.__readerGestureLoaded = true
  var on = false, fired = false, inPre = false, onLink = false
  var sx = 0, sy = 0, lx = 0, ly = 0, st = 0, far = 0
  var lastTap = 0, lastXTap = 0, lastYTap = 0
  function send(type) {
    try {
      var w = window.webkit
      if (w && w.messageHandlers && w.messageHandlers.readerGesture) {
        w.messageHandlers.readerGesture.postMessage(JSON.stringify({ t: type }))
      }
    } catch (err) {}
  }
  function trySwipe() {
    if (fired || inPre) return false
    var dx = lx - sx, dy = ly - sy
    if (Math.abs(dx) >= 80 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      fired = true
      on = false
      send(dx < 0 ? 'swipeLeft' : 'swipeRight')
      return true
    }
    return false
  }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { on = false; return }
    var t = e.touches[0]
    on = true; fired = false
    sx = t.clientX; sy = t.clientY
    lx = sx; ly = sy
    st = Date.now(); far = 0
    var el = e.target
    if (el && el.closest) {
      inPre = !!(el.closest('pre') || el.closest('input') || el.closest('textarea') || el.closest('select'))
      onLink = !!(el.closest('a') || el.closest('button'))
    }
  }, { passive: true })
  document.addEventListener('touchmove', function (e) {
    if (!on) return
    var t = e.touches[0]
    if (!t) return
    lx = t.clientX; ly = t.clientY
    var ddx = lx - sx, ddy = ly - sy
    var d = Math.sqrt(ddx * ddx + ddy * ddy)
    if (d > far) far = d
    trySwipe()   // 阈值一到立即上报：不等抬手（原生接管前就先判到）
  }, { passive: true })
  function finish(tapAllowed) {
    if (!on) return
    on = false
    var now = Date.now()
    var dt = now - st
    if (trySwipe()) { lastTap = 0; return }
    if (tapAllowed && !fired && dt <= 400 && far <= 30 && !onLink) {
      if (lastTap && now - lastTap < 300 && Math.abs(lx - lastXTap) < 44 && Math.abs(ly - lastYTap) < 44) {
        lastTap = 0
        send('doubleTap')
        return
      }
      lastTap = now
      lastXTap = lx
      lastYTap = ly
      return
    }
    lastTap = 0
  }
  document.addEventListener('touchend', function () { finish(true) }, { passive: true })
  // 原生滚动接管时 WKWebView 发 touchcancel 而非 touchend——这里兜底再判一次滑动
  document.addEventListener('touchcancel', function () { finish(false) }, { passive: true })
})()`

/** 正文触控权（配合 GESTURE_JS v2）：pan-y=竖向滚动归原生；pinch-zoom=保留捏合缩放；
 *  横向平移不在许可内 → 横向手势完整留给页面 JS（修「滚动接管吞 touchend」）；
 *  双击缩放同样不在许可内（双击已映射为退出）。 */
export const GESTURE_CSS = "touch-action: pan-y pinch-zoom;"