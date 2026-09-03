// submon 入口：全屏运行（脚本列表点按，或桌面小组件 widgetURL 唤起）
import { Navigation, Script } from "scripting"
import { SubmonApp } from "./app"

async function run() {
  Script.enableMinimize()
  await Navigation.present({
    element: <SubmonApp />,
    modalPresentationStyle: "overFullScreen",
  })
  Script.exit()
}

run()