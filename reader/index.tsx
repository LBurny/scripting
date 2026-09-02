// Reader 入口：全屏运行（脚本列表点按，或桌面小组件 widgetURL 唤起）
import { Navigation, Script } from "scripting"
import { ReaderApp } from "./app"
import { flushArticles } from "./lib/store"

async function run() {
  Script.enableMinimize()
  await Navigation.present({
    element: <ReaderApp />,
    modalPresentationStyle: "overFullScreen",
  })
  flushArticles() // 冲刷 store 合并写盘的未落盘状态（已读/收藏/全文缓存）
  Script.exit()
}

run()
