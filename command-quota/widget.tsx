// widget.tsx — 桌面小组件入口
// 数据新鲜度要点：credits / subs / summary 压进**同一轮并行**（带上缓存里的 orgId+周期提示，跳过 whoami），
// 6s 预算内拿不到才回退上次成功快照 —— 回退时界面明确标注「缓存 X 前」，
// 绝不用渲染时刻冒充数据时刻（那正是「组件和 App 不一致」的根源）。
import { VStack, Widget, Script } from 'scripting'
import {
  loadAccounts, fetchQuota, withTimeout, loadWidgetCache, saveWidgetCache, toCached, emptyCached,
  hintOf, usableCache, cacheFor, fromUsageState, fromCachedState, agoText, CachedState, Usage,
} from './core'
import { WState, SmallSingle, SmallDual, MultiW, Placeholder } from './widget-ui'

/** 一轮并行请求的预算：接口单次 2.4–5.1s，压成一轮后 3–5s 能回来；超时即回退缓存 */
const FETCH_TIMEOUT = 6000

const TIMEOUT_USAGE: Usage = {
  five: null, weekly: null, planId: "", plan: "", planMonthly: null, status: "", periodEnd: null,
  monthlyRemaining: 0, extraRemaining: 0, totalRemaining: 0, totalSpent: 0, totalPool: 0, usagePct: 0,
  requests: 0, tokens: 0, tokensIn: 0, tokensOut: 0, userName: "", orgName: "",
  orgId: null, periodStart: null, summaryOk: false, error: "请求超时",
}

/** Key 无效属配置问题：直接暴露，不用旧数据掩盖 */
function isConfigError(msg: string): boolean {
  return /401|无效/.test(msg)
}

/* 渲染日志：数据来源 + 耗时，供「组件与 App 数值不一致」时复查。失败静默 */
function renderLog(msg: string) {
  try {
    const dir = FileManager.appGroupDocumentsDirectory + "/command-quota"
    if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true)
    const f = dir + "/widget-render-log.txt"
    let lines: string[] = []
    try { lines = FileManager.readAsStringSync(f).split("\n").filter(Boolean) } catch {}
    const d = new Date()
    const p = (n: number) => (n < 10 ? "0" + n : String(n))
    lines.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${msg}`)
    FileManager.writeAsStringSync(f, lines.slice(-80).join("\n") + "\n")
  } catch {}
}

/** 每次 present 都申请 15 分钟后重排时间线，缩短「组件比 App 落后」的窗口 */
function present(node: any) {
  try {
    Widget.present(node, { reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60000) } })
  } catch {
    Widget.present(node)
  }
}

async function main() {
  const t0 = Date.now()
  try {
    const accounts = loadAccounts()
    if (!accounts.length) {
      renderLog(`family=${Widget.family} no-accounts`)
      present(<Placeholder text="请先在 App 中添加 API Key" icon="key.fill" />)
      return
    }
    const cache = loadWidgetCache()
    const now = Date.now()
    const results = await Promise.all(accounts.map(async (a, i) => {
      const c = usableCache(cacheFor(cache, a.name, i))
      const u = await withTimeout(
        fetchQuota(a.key, { hint: hintOf(c), followUpSummary: false }),
        FETCH_TIMEOUT,
        TIMEOUT_USAGE,
      )
      if (!u.error) {
        return { name: a.name, cached: c, usage: u, st: fromUsageState(a.name, u, now), source: u.summaryOk ? "fresh" : "fresh(no-summary)" }
      }
      if (isConfigError(u.error)) {
        return { name: a.name, cached: c, usage: u, st: fromUsageState(a.name, u, now), source: `err:${u.error}` }
      }
      if (c) {
        return { name: a.name, cached: c, usage: u, st: fromCachedState(c), source: `cache:${agoText(c.ts, now)}` }
      }
      return { name: a.name, cached: c, usage: u, st: fromUsageState(a.name, u, now), source: `err:${u.error}` }
    }))
    // 写回缓存：只有本轮真正取到数据的账号才前移时间戳；失败的账号原样保留旧快照（ts 不变），
    // 这样界面上的「缓存 X 前」才是真话
    saveWidgetCache(results.map(r => (r.usage.error ? r.cached ?? emptyCached(r.name) : toCached(r.name, r.usage, r.cached))))
    renderLog(`family=${Widget.family} ${results.map(r => `${r.name}=${r.source}`).join(" ")} ${Date.now() - t0}ms`)
    const states: WState[] = results.map(r => r.st)
    present(
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} widgetURL={Script.createRunURLScheme("command-quota")}>
        {Widget.family === "systemSmall" ? (
          states.length === 1 ? <SmallSingle st={states[0]} /> : <SmallDual states={states} />
        ) : (
          <MultiW states={states} expanded={Widget.family === "systemLarge"} />
        )}
      </VStack>
    )
  } catch (e: any) {
    // 兜底：任何意外异常都必须 present，否则系统显示「设置小组件」占位
    renderLog(`family=${Widget.family} exception:${String(e?.message || e || "unknown")} ${Date.now() - t0}ms`)
    try { present(<Placeholder text="组件加载失败，稍后重试" icon="exclamationmark.triangle" />) } catch {}
  }
}

main()
