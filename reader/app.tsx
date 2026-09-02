// Reader 主界面（index.tsx 全屏运行与 home_screen_default_ui.tsx 首页 Tab 共用）
// 交互形式对齐 Surge Panel：原生底部 TabView + 关闭/刷新/最小化工具栏
import {
  Button,
  Image,
  Navigation,
  NavigationStack,
  Picker,
  Script,
  Tab,
  TabView,
  Text,
  Toolbar,
  ToolbarItem,
  useEffect,
  useObservable,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { refreshAll } from "./lib/store"
import { emitDataChanged } from "./lib/bus"
import { ArticleListView } from "./views/ArticleListView"
import { FeedsView } from "./views/FeedsView"

const TAB_TITLES = ["文章", "未读", "收藏", "订阅"]

// 页面骨架：顶部分隔线 + 下方内容。
// 实测（真机截图推算）：页面内容区本身从导航栏下方开始，但 List 作根内容时
// 会全屏出血滚到按钮后面；嵌进 VStack 后 List 遵循自身 frame（从导航栏下方开始），
// 滚动时在导航栏下缘裁剪——不再与按钮交叠，也不产生额外空白块。之前 103pt 占位区
// 是双倍间距（内容区起点已在导航栏下方），用户实测否决。背景修饰符不可靠，
// 遮挡效果完全依赖布局裁剪。
function TabPage({ children }: { children: any }) {
  return (
    <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 分隔线：位于导航栏下缘，标记滚动内容的裁剪边界 */}
      <VStack frame={{ maxWidth: "infinity", height: 0.5 }} background={{ style: "separator", shape: "rect" }} />
      {children}
    </VStack>
  )
}

// 顶部工具栏图标按钮：简洁裸图标（滚动遮挡靠 TabPage 固定顶栏解决，勿加按钮背景）
// spinTick 变化时重播 SF Symbol 旋转动效（rotationEffect/animation 在此运行时是无效摆设，
// preview 实测不渲染；symbolEffect 才是原生可用的旋转方案）
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

export function ReaderApp() {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)
  const [refreshing, setRefreshing] = useState(false)
  const [spinTick, setSpinTick] = useState(0)
  // 首页 Tab 环境（Scripting App 首页承载）：改用顶部分段选择器，避免与 App 底栏叠出双层标签栏
  const isHome = Script.env === "home_screen"

  async function doRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setSpinTick(v => v + 1) // 触发刷新图标旋转一圈
    try {
      await refreshAll()
    } catch {}
    emitDataChanged()
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
            <Tab title="文章" value={0}>
              <ArticleListView filter="all" selection={selection} tabIndex={0} />
            </Tab>
            <Tab title="未读" value={1}>
              <ArticleListView filter="unread" selection={selection} tabIndex={1} />
            </Tab>
            <Tab title="收藏" value={2}>
              <ArticleListView filter="starred" selection={selection} tabIndex={2} />
            </Tab>
            <Tab title="订阅" value={3}>
              <FeedsView />
            </Tab>
          </TabView>
        </VStack>
      </NavigationStack>
    )
  }

  // ---------- 全屏运行：原生底部 TabView ----------
  const toolbar = (
    <Toolbar>
      {/* 关闭 */}
      <ToolbarItem placement="topBarLeading">
        <ToolbarIcon name="xmark" label="关闭" action={() => dismiss()} />
      </ToolbarItem>

      {/* 刷新 */}
      <ToolbarItem placement="topBarTrailing">
        <ToolbarIcon
          name="arrow.clockwise"
          label="刷新"
          spinTick={spinTick}
          action={() => doRefresh()}
        />
      </ToolbarItem>

      {/* 最小化（支持时） */}
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
        tint="systemOrange"
        toolbar={toolbar}
        tabBarMinimizeBehavior="onScrollDown"
        scrollEdgeEffectHidden="bottom"
        ignoresSafeArea={{ regions: "container", edges: "bottom" }}
      >
        <Tab title="文章" systemImage="newspaper" value={0}>
          <TabPage><ArticleListView filter="all" selection={selection} tabIndex={0} /></TabPage>
        </Tab>
        <Tab title="未读" systemImage="tray.full" value={1}>
          <TabPage><ArticleListView filter="unread" selection={selection} tabIndex={1} /></TabPage>
        </Tab>
        <Tab title="收藏" systemImage="star" value={2}>
          <TabPage><ArticleListView filter="starred" selection={selection} tabIndex={2} /></TabPage>
        </Tab>
        <Tab title="订阅" systemImage="dot.radiowaves.up.forward" value={3}>
          <TabPage><FeedsView /></TabPage>
        </Tab>
      </TabView>
    </NavigationStack>
  )
}
