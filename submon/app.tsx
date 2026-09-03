// submon 主界面（index.tsx 全屏运行与 home_screen_default_ui.tsx 首页 Tab 共用）
// 交互形式仿 reader：全屏 = 原生底部 TabView + 关闭/刷新/最小化工具栏；首页 Tab = 顶部分段选择器 + 横滑翻页
import {
  Button, Image, Navigation, NavigationStack, Picker, Script, Tab, TabView, Text,
  Toolbar, ToolbarItem, useEffect, useObservable, useState, VStack, ZStack,
} from "scripting"
import { Widget } from "scripting"
import { refreshAll } from "./lib/store"
import { emitDataChanged } from "./lib/bus"
import { ConvertView } from "./views/ConvertView"
import { SubListView } from "./views/SubListView"
import { SettingsView } from "./views/SettingsView"

const TAB_TITLES = ["转换", "订阅", "设置"]

// 顶部工具栏图标按钮（spinTick 变化时重播旋转动效，同 reader）
function ToolbarIcon({ name, label, action, spinTick }: { name: string; label: string; action: () => void; spinTick?: number }) {
  return (
    <Button action={action} buttonStyle="plain" accessibilityLabel={label}>
      <Image
        systemName={name}
        font="headline"
        foregroundStyle="label"
        symbolEffect={spinTick !== undefined ? { effect: "rotateClockwise", value: spinTick, options: { speed: 2, nonRepeating: true } } : undefined}
      />
    </Button>
  )
}

export function SubmonApp() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)
  const [refreshing, setRefreshing] = useState(false)
  const [spinTick, setSpinTick] = useState(0)
  const isHome = Script.env === "home_screen"

  async function doRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setSpinTick((v) => v + 1)
    try {
      await refreshAll()
    } catch {}
    emitDataChanged()
    // 通知桌面小组件同步重绘（失败忽略）
    try { Widget.reloadAll() } catch {}
    setRefreshing(false)
  }

  useEffect(() => {
    doRefresh()
  }, [])

  // ---------- 首页 Tab：顶部分段器 + 左右滑动翻页 ----------
  if (isHome) {
    const current = selection.value
    return (
      <NavigationStack
        tabBarVisibility="visible"
        ignoresSafeArea={{ regions: "container", edges: "bottom" }}
      >
        <VStack
          spacing={0}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          tabBarVisibility="visible"
          ignoresSafeArea={{ regions: "container", edges: "bottom" }}
          scrollEdgeEffectHidden="bottom"
        >
          <Picker
            label={<Text>页面切换</Text>}
            pickerStyle="segmented"
            value={String(current)}
            onChanged={(v: string) => selection.setValue(Number(v))}
            padding={{ horizontal: 16, top: 8, bottom: 4 }}
          >
            {TAB_TITLES.map((t, i) => (
              <Text key={t} tag={String(i)}>{t}</Text>
            ))}
          </Picker>
          <TabView
            selection={selection}
            tabViewStyle="page"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            ignoresSafeArea={{ regions: "container", edges: "bottom" }}
            scrollEdgeEffectHidden="bottom"
          >
            <Tab title="转换" value={0}>
              <ConvertView />
            </Tab>
            <Tab title="订阅" value={1}>
              <SubListView />
            </Tab>
            <Tab title="设置" value={2}>
              <SettingsView />
            </Tab>
          </TabView>
        </VStack>
      </NavigationStack>
    )
  }

  // ---------- 全屏运行：原生底部 TabView ----------
  const toolbar = (
    <Toolbar>
      <ToolbarItem placement="topBarLeading">
        <ToolbarIcon name="xmark" label="关闭" action={() => dismiss()} />
      </ToolbarItem>
      <ToolbarItem placement="topBarTrailing">
        <ToolbarIcon
          name="arrow.clockwise"
          label="刷新"
          spinTick={spinTick}
          action={() => doRefresh()}
        />
      </ToolbarItem>
      {Script.supportsMinimization() ? (
        <ToolbarItem placement="topBarTrailing">
          <ToolbarIcon
            name="arrow.down.right.and.arrow.up.left"
            label="最小化"
            action={() => {
              if (!Script.isMinimized()) Script.minimize().catch(() => {})
            }}
          />
        </ToolbarItem>
      ) : undefined}
    </Toolbar>
  )

  return (
    <NavigationStack>
      <TabView
        selection={selection}
        tint="systemGreen"
        toolbar={toolbar}
        toolbarBackgroundVisibility={{ visibility: "visible", bars: ["navigationBar"] }}
        tabBarMinimizeBehavior="onScrollDown"
        scrollEdgeEffectHidden="bottom"
        ignoresSafeArea={{ regions: "container", edges: "bottom" }}
      >
        <Tab title="转换" systemImage="wand.and.stars" value={0}>
          <ConvertView />
        </Tab>
        <Tab title="订阅" systemImage="gauge.with.needle" value={1}>
          <SubListView />
        </Tab>
        <Tab title="设置" systemImage="gearshape" value={2}>
          <SettingsView />
        </Tab>
      </TabView>
    </NavigationStack>
  )
}