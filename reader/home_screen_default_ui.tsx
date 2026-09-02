// Reader 首页 Tab UI（Scripting App 首页承载，Settings 里开启 Show Home Tab 后选择本脚本）
// 与 index.tsx 的区别：组件被直接挂载到 Tab，不 present、不 exit，实例常驻。
import { Script, useEffect } from "scripting"
import { refreshAll } from "./lib/store"
import { emitDataChanged } from "./lib/bus"
import { ReaderApp } from "./app"

// 回到首页自动刷新的最小间隔：Tab 常驻，避免用户来回切 Tab 每次都全量拉源+写盘
const REFRESH_MIN_INTERVAL = 60_000
let lastAutoRefreshAt = 0

export default function HomeScreenView() {
  useEffect(() => {
    // Tab 常驻：回到首页时刷新一次（60s 最小间隔）
    const off = Script.onHomeTabEvent((event) => {
      if (event !== "selected") return
      if (Date.now() - lastAutoRefreshAt < REFRESH_MIN_INTERVAL) return
      lastAutoRefreshAt = Date.now()
      refreshAll().catch(() => {}).finally(() => emitDataChanged())
    })
    return () => off()
  }, [])

  return <ReaderApp />
}
