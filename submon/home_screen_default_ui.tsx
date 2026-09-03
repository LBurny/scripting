// submon 首页 Tab UI（Scripting App 首页承载，Settings 里开启 Show Home Tab 后选择本脚本）
// 与 index.tsx 的区别：组件被直接挂载到 Tab，不 present、不 exit，实例常驻。
import { Script, useEffect } from "scripting"
import { refreshAll } from "./lib/store"
import { emitDataChanged } from "./lib/bus"
import { SubmonApp } from "./app"

// 回到首页自动刷新的最小间隔：Tab 常驻，避免来回切 Tab 频繁拉订阅
const REFRESH_MIN_INTERVAL = 60_000
let lastAutoRefreshAt = 0

export default function HomeScreenView() {
  useEffect(() => {
    const off = Script.onHomeTabEvent((event) => {
      if (event !== "selected") return
      if (Date.now() - lastAutoRefreshAt < REFRESH_MIN_INTERVAL) return
      lastAutoRefreshAt = Date.now()
      refreshAll().catch(() => {}).finally(() => emitDataChanged())
    })
    return () => off()
  }, [])

  return <SubmonApp />
}