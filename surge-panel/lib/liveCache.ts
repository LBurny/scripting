// 仅当前可见 Tab 按面板间隔自动刷新
// 用选择器订阅：speedHistory 每秒 patch，不能让挂了本 Hook 的长列表页每秒重渲染
import { useEffect } from "scripting"
import { needsSetup, useStoreSelector } from "./store"

export function useTabAutoRefresh(tabIndex: number, load: () => void | Promise<void>) {
  const { visibleTab, autoRefresh, intervalSec, config } = useStoreSelector((s) => ({
    visibleTab: s.visibleTab,
    autoRefresh: s.prefs.autoRefresh,
    intervalSec: s.prefs.intervalSec,
    config: s.config,
  }))
  useEffect(() => {
    if (visibleTab !== tabIndex) return
    if (needsSetup()) return
    void load()
    if (!autoRefresh) return
    const id = setInterval(() => {
      if (needsSetup()) return
      void load()
    }, intervalSec * 1000)
    return () => clearInterval(id)
  }, [visibleTab, autoRefresh, intervalSec, config])
}
