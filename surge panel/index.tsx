// Surge Panel 入口：全屏运行（Scripting 脚本列表点按）
import { Navigation, Script } from "scripting"
import { initStore, refreshNow } from "./lib/store"
import { SurgePanelApp } from "./app"

async function run() {
  Script.enableMinimize()
  initStore()
  await refreshNow().catch(() => {})
  await Navigation.present({
    element: <SurgePanelApp />,
    modalPresentationStyle: "overFullScreen",
  })
  Script.exit()
}

run()
