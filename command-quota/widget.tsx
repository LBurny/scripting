// widget.tsx — 桌面小组件入口
// 稳定性要点：8s 超时 + 失败回退上次成功缓存，保证每次都渲染出内容
import { VStack, Widget, Script } from 'scripting'
import { loadAccounts, fetchQuota, withTimeout, loadWidgetCache, saveWidgetCache, toCached, CachedState, Usage } from './core'
import { WState, SmallSingle, SmallDual, MultiW, Placeholder } from './widget-ui'

const FETCH_TIMEOUT = 5000
const TIMEOUT_USAGE: Usage = {
  five: null, weekly: null, planId: "", plan: "", planMonthly: null, status: "", periodEnd: null,
  monthlyRemaining: 0, extraRemaining: 0, totalRemaining: 0, totalSpent: 0, totalPool: 0, usagePct: 0,
  requests: 0, tokens: 0, tokensIn: 0, tokensOut: 0, userName: "", orgName: "", error: "请求超时",
}

function cacheHit(cache: CachedState[], a: { name: string }, i: number): CachedState | null {
  const byIdx = cache[i]
  if (byIdx && byIdx.name === a.name) return byIdx
  return cache.find(c => c.name === a.name) ?? null
}

function fromCache(name: string, c: CachedState): WState {
  return {
    name, plan: c.plan, five: c.five, weekly: c.weekly,
    totalRemaining: c.totalRemaining, monthlyRemaining: c.monthlyRemaining,
    extraRemaining: c.extraRemaining, usagePct: c.usagePct,
    requests: c.requests, tokens: c.tokens, totalSpent: c.totalSpent, error: "",
  }
}

async function main() {
  const accounts = loadAccounts()
  if (!accounts.length) {
    Widget.present(<Placeholder text="请先在 App 中添加 API Key" icon="key.fill" />)
    return
  }
  const cache = loadWidgetCache()
  const states: WState[] = await Promise.all(accounts.map(async (a, i) => {
    const u = await withTimeout(fetchQuota(a.key), FETCH_TIMEOUT, TIMEOUT_USAGE)
    if (!u.error) {
      return {
        name: a.name, plan: u.plan, five: u.five, weekly: u.weekly,
        totalRemaining: u.totalRemaining, monthlyRemaining: u.monthlyRemaining,
        extraRemaining: u.extraRemaining, usagePct: u.usagePct,
        requests: u.requests, tokens: u.tokens, totalSpent: u.totalSpent, error: "",
      }
    }
    const c = cacheHit(cache, a, i)
    if (c) return fromCache(a.name, c)
    return {
      name: a.name, plan: "", five: null, weekly: null,
      totalRemaining: 0, monthlyRemaining: 0, extraRemaining: 0, usagePct: 0,
      requests: 0, tokens: 0, totalSpent: 0, error: u.error,
    }
  }))
  // 只把有数据的账号写回缓存；失败的账号保留旧缓存条目
  const next: CachedState[] = states.map((st, i) => {
    const old = cacheHit(cache, accounts[i], i)
    if (st.error) {
      return old ?? {
        name: st.name, plan: "", five: null, weekly: null,
        totalRemaining: 0, monthlyRemaining: 0, extraRemaining: 0, usagePct: 0,
        requests: 0, tokens: 0, totalSpent: 0, ts: 0,
      }
    }
    return {
      name: st.name, plan: st.plan, five: st.five, weekly: st.weekly,
      totalRemaining: st.totalRemaining, monthlyRemaining: st.monthlyRemaining,
      extraRemaining: st.extraRemaining, usagePct: st.usagePct,
      requests: st.requests, tokens: st.tokens, totalSpent: st.totalSpent, ts: Date.now(),
    }
  })
  saveWidgetCache(next)
  Widget.present(
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} widgetURL={Script.createRunURLScheme("command-quota")}>
      {Widget.family === "systemSmall" ? (
        states.length === 1 ? <SmallSingle st={states[0]} /> : <SmallDual states={states} />
      ) : (
        <MultiW states={states} expanded={Widget.family === "systemLarge"} />
      )}
    </VStack>
  )
}

main()
