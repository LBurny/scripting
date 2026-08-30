import {
  Script,
  Navigation,
  VStack,
  HStack,
  ZStack,
  Text,
  TextField,
  Button,
  Image,
  Spacer,
  WebView,
  ProgressView,
  List,
  Section,
  Widget,
  useState,
} from "scripting"
import {
  getConnectionURL,
  setConnectionURL,
  getDeviceName,
  getHost,
  isValidURL,
} from "./store"

const ACCENT = "#5856D6"
const BAR_BG = "#0D0D0D" // matches ZCode zai-dark page background
// Bottom bar palette (Apple dark-system colors)
const HAIRLINE = "rgba(255,255,255,0.08)"
const PILL_BG = "rgba(255,255,255,0.07)"
const PILL_BG_ERR = "rgba(255,69,58,0.15)"
const ICON = "rgba(255,255,255,0.92)"
const ICON_DIM = "rgba(255,255,255,0.28)"
const OK_GREEN = "#30D158"
const ERR_RED = "#FF453A"
// Settings sheet palette (matches the main page)
const ROW_BG = "rgba(255,255,255,0.06)"
const TEXT_SECONDARY = "rgba(255,255,255,0.55)"
const TEXT_TERTIARY = "rgba(255,255,255,0.40)"

// Home-indicator bottom inset. safeAreaInsets is unavailable at runtime, so
// detect Face-ID iPhones by their taller-than-2:1 screen (all of them have the
// 34pt bottom inset; Touch-ID phones and iPads use 0).
const _screen = Device.screen
const HOME_BAR_INSET =
  !Device.isiPad &&
  Math.max(_screen.width, _screen.height) /
      Math.min(_screen.width, _screen.height) >
    2
    ? 34
    : 0

type Status = "loading" | "ok" | "error"

// One controller (and thus one web session) per script instance.
// Global class — DO NOT import from "scripting".
const controller = new WebViewController()
let lastLoadedURL: string | null = null

function SettingsSheet(props: { onSaved: (device: string) => void }) {
  const dismiss = Navigation.useDismiss()
  const [url, setUrl] = useState(getConnectionURL())
  const trimmed = url.trim()
  const valid = isValidURL(trimmed)

  const save = () => {
    setConnectionURL(trimmed)
    Widget.reloadAll()
    props.onSaved(getDeviceName(trimmed))
    dismiss()
  }

  const paste = async () => {
    const s = await Pasteboard.getString()
    if (s && s.trim()) setUrl(s.trim())
  }

  return (
    // Custom dark header + manually themed List: preferredColorScheme is a
    // no-op in this runtime (device may be in light mode), so everything is
    // styled explicitly to match the main page.
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={{ style: BAR_BG, shape: "rect" }}
    >
      {/* Header: centered title + trailing Done button */}
      <ZStack
        frame={{ maxWidth: "infinity", height: 44 }}
        padding={{ leading: 16, trailing: 16 }}
      >
        <Text font={17} fontWeight="semibold" foregroundStyle={ICON as any}>
          连接设置
        </Text>
        <HStack frame={{ maxWidth: "infinity" }}>
          <Spacer />
          <Button title="完成" tint={ACCENT} action={() => dismiss()} />
        </HStack>
      </ZStack>

      <List
        scrollContentBackground="hidden"
        background={{ style: BAR_BG, shape: "rect" }}
      >
        <Section
          header={<Text foregroundStyle={TEXT_SECONDARY as any}>连接地址</Text>}
          footer={
            <Text foregroundStyle={TEXT_TERTIARY as any}>
              ZCode 链接中的 sid / hash 会过期。拿到新链接后粘贴到此处并保存，会自动重新连接并刷新小组件。
            </Text>
          }
        >
          <TextField
            title="https://zcode.z.ai/remote/v4?..."
            value={url}
            onChanged={setUrl}
            keyboardType="URL"
            autocorrectionDisabled
            textInputAutocapitalization="never"
            foregroundStyle={ICON as any}
            tint={ACCENT}
            listRowBackground={<RowBackground />}
          />
          <HStack spacing={16} listRowBackground={<RowBackground />}>
            <Button title="粘贴剪贴板" tint={ACCENT} action={paste} />
            <Button
              title="在 Safari 打开"
              tint={ACCENT}
              action={() => Safari.openURL(getConnectionURL())}
            />
          </HStack>
        </Section>
        <Section>
          {/* Full-width prominent button: custom label with Spacers +
              zero horizontal row insets. */}
          <Button
            action={save}
            buttonStyle="borderedProminent"
            tint={ACCENT}
            disabled={!valid}
            frame={{ maxWidth: "infinity" }}
            listRowInsets={{ top: 10, leading: 0, bottom: 10, trailing: 0 }}
            listRowBackground={<RowBackground />}
          >
            <HStack frame={{ maxWidth: "infinity" }}>
              <Spacer />
              <Text fontWeight="semibold">保存并重新连接</Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
        <Section
          header={<Text foregroundStyle={TEXT_SECONDARY as any}>小组件</Text>}
          footer={
            <Text foregroundStyle={TEXT_TERTIARY as any}>
              点击桌面小组件任意位置即可直接进入此页面。
            </Text>
          }
        >
          <Text
            font={14}
            foregroundStyle={ICON as any}
            listRowBackground={<RowBackground />}
          >
            长按桌面 → 左上角 + → 搜索 Scripting → 选择 ZCode Remote（建议小号）
          </Text>
        </Section>
      </List>
    </VStack>
  )
}

// Dark grouped-row background used by every row in the settings sheet.
function RowBackground() {
  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={{ style: ROW_BG, shape: "rect" }}
    />
  )
}

function AppView() {
  const dismiss = Navigation.useDismiss()
  const [status, setStatus] = useState<Status>("loading")
  const [showSettings, setShowSettings] = useState(false)
  const [device, setDevice] = useState(getDeviceName(getConnectionURL()))
  const [navTick, setNavTick] = useState(0) // forces re-render to refresh back/forward state

  const load = async (force = false) => {
    const url = getConnectionURL()
    if (!force && lastLoadedURL === url) return
    lastLoadedURL = url
    setStatus("loading")
    try {
      const ok = await controller.loadURL(url)
      setStatus(ok ? "ok" : "error")
      console.log("WebView loadURL:", url, "=>", ok)
    } catch (e) {
      console.log("WebView loadURL error:", String(e))
      setStatus("error")
    }
    setNavTick((t) => t + 1)
  }

  const waitAndSettle = async () => {
    try {
      await controller.waitForLoad()
      setStatus("ok")
    } catch {
      setStatus("error")
    }
    setNavTick((t) => t + 1)
  }

  const goBack = async () => {
    if (!controller.canGoBack()) return
    setStatus("loading")
    controller.goBack()
    await waitAndSettle()
  }

  const goForward = async () => {
    if (!controller.canGoForward()) return
    setStatus("loading")
    controller.goForward()
    await waitAndSettle()
  }

  const reload = () => {
    setStatus("loading")
    controller.reload()
    waitAndSettle()
  }

  // Re-computed each render (navTick forces refresh after navigations).
  void navTick
  const canBack = controller.canGoBack()
  const canForward = controller.canGoForward()

  return (
    <ZStack
      alignment="bottom"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      preferredColorScheme="dark"
      background={{ style: BAR_BG, shape: "rect" }}
      ignoresSafeArea={{ edges: ["bottom"] }}
      sheet={{
        isPresented: showSettings,
        onChanged: setShowSettings,
        content: (
          <SettingsSheet
            onSaved={(d) => {
              setDevice(d)
              lastLoadedURL = null
              load(true)
            }}
          />
        ),
      }}
    >
      {/* Full-bleed web content: extends under the status bar AND behind the
          bottom bar / home-indicator strip (webview bg matches BAR_BG). */}
      <WebView
        controller={controller}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea={{ edges: ["top", "leading", "trailing", "bottom"] }}
        onAppear={() => load()}
      />

      {/* Bottom control bar — modern browser style.
          Extends into the bottom safe area so the home-indicator strip
          stays dark; content is padded back up by HOME_BAR_INSET. */}
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity" }}
        background={{ style: BAR_BG, shape: "rect" }}
        ignoresSafeArea={{ edges: ["bottom"] }}
      >
        {/* Hairline separator above the bar */}
        <HStack
          frame={{ maxWidth: "infinity", height: 0.5 }}
          background={{ style: HAIRLINE, shape: "rect" }}
        />
        <HStack
          spacing={0}
          padding={{ leading: 18, trailing: 18, top: 10, bottom: 10 + HOME_BAR_INSET }}
          frame={{ maxWidth: "infinity" }}
        >
          {/* Exit */}
          <Button
            title="退出"
            systemImage="xmark"
            labelStyle="iconOnly"
            imageScale="medium"
            tint={ICON as any}
            action={() => dismiss()}
          />
          <Spacer />

          {/* Back / Forward — segmented capsule */}
          <HStack
            spacing={22}
            padding={{ leading: 14, trailing: 14, top: 7, bottom: 7 }}
            background={{ style: PILL_BG, shape: "capsule" }}
          >
            <Button
              title="返回"
              systemImage="chevron.left"
              labelStyle="iconOnly"
              disabled={!canBack}
              tint={(canBack ? ICON : ICON_DIM) as any}
              action={goBack}
            />
            <Button
              title="前进"
              systemImage="chevron.right"
              labelStyle="iconOnly"
              disabled={!canForward}
              tint={(canForward ? ICON : ICON_DIM) as any}
              action={goForward}
            />
          </HStack>
          <Spacer />

          {/* Center status pill: tappable to retry on error */}
          <Button
            buttonStyle="plain"
            action={() => {
              if (status === "error") reload()
            }}
          >
            <HStack
              spacing={6}
              padding={{ leading: 12, trailing: 12, top: 7, bottom: 7 }}
              frame={{ maxWidth: 150 }}
              background={{
                style: (status === "error" ? PILL_BG_ERR : PILL_BG) as any,
                shape: "capsule",
              }}
            >
              {status === "loading" ? (
                <ProgressView tint={ICON as any} />
              ) : (
                <Text
                  font={9}
                  foregroundStyle={(status === "ok" ? OK_GREEN : ERR_RED) as any}
                >
                  {"\u25CF"}
                </Text>
              )}
              <Text
                font={12}
                fontWeight="semibold"
                foregroundStyle={(status === "error" ? ERR_RED : ICON) as any}
                lineLimit={1}
              >
                {status === "error" ? "连接失败 · 点按重试" : device}
              </Text>
            </HStack>
          </Button>
          <Spacer />

          {/* Reload */}
          <Button
            title="刷新"
            systemImage={status === "loading" ? "xmark" : "arrow.clockwise"}
            labelStyle="iconOnly"
            imageScale="medium"
            tint={ICON as any}
            action={() => {
              if (status === "loading") {
                load(true)
              } else {
                reload()
              }
            }}
          />
          <Spacer />

          {/* Settings */}
          <Button
            title="设置"
            systemImage="gearshape"
            labelStyle="iconOnly"
            imageScale="medium"
            tint={ICON as any}
            action={() => setShowSettings(true)}
          />
        </HStack>
      </VStack>
    </ZStack>
  )
}

async function run() {
  // fullScreen: cover the whole screen instead of the default card-sheet.
  await Navigation.present({
    element: <AppView />,
    modalPresentationStyle: "fullScreen",
  })
  // Page dismissed — release the web session and terminate.
  controller.dispose()
  Script.exit()
}

run()