// Surge Panel 首页 Tab UI（Scripting App 首页承载，Settings 里开启 Show Home Tab 后选择本脚本）
// 与 index.tsx 的区别：组件被直接挂载到 Tab，不 present、不 exit，实例常驻。
import { Script, useEffect } from "scripting"
import { initStore, refreshNow, startPolling, stopPolling } from "./lib/store"
import { SurgePanelApp } from "./app"

// 顶层代码只在 Tab 首次构建时执行一次
initStore()
void refreshNow().catch(() => {})

export default function HomeScreenView() {
  useEffect(() => {
    // Tab 常驻：离开首页时暂停轮询节能，回来时刷新并恢复
    const off = Script.onHomeTabEvent((event) => {
      if (event === "selected") {
        void refreshNow().catch(() => {})
        startPolling()
      } else if (event === "deselected") {
        stopPolling()
      }
    })
    return () => off()
  }, [])

  return <SurgePanelApp />
}
