import {
  VStack,
  HStack,
  Text,
  Image,
  Spacer,
  Widget,
  Link,
  Script,
  type DynamicShapeStyle,
} from "scripting"
import {
  getConnectionURL,
  getDeviceName,
  getHost,
  getAppVersion,
} from "./store"

// Surge-panel-style palette. Colors adapt to light / dark mode via
// DynamicShapeStyle so the panel looks native in both appearances.
const GREEN = "#22C55E"
const GREEN_DEEP = "#15803D" // stronger green for light-mode text contrast

// Panel background: soft porcelain gradient in light, deep navy in dark.
// (runtime gradient form keeps the `type: "linear"` tag)
const PANEL_BG = {
  light: {
    type: "linear",
    colors: ["#FFFFFF", "#E9EEF6"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0.5, y: 1 },
  },
  dark: {
    type: "linear",
    colors: ["#16213A", "#101828"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0.6, y: 1 },
  },
} as unknown as DynamicShapeStyle

const C: Record<string, DynamicShapeStyle> = {
  primaryText: { light: "#0F172A", dark: "#FFFFFF" },
  secondaryText: { light: "rgba(15,23,42,0.55)", dark: "rgba(255,255,255,0.55)" },
  faintText: { light: "rgba(15,23,42,0.38)", dark: "rgba(255,255,255,0.38)" },
  icon: { light: "rgba(15,23,42,0.75)", dark: "rgba(255,255,255,0.85)" },
  accent: { light: GREEN_DEEP, dark: GREEN },
  accentBg: { light: "rgba(21,128,61,0.10)", dark: "rgba(34,197,94,0.16)" },
  danger: { light: "#DC2626", dark: "#EF4444" },
}

type Status = "checking" | "ready" | "down"

type Info = {
  status: Status
  latency: number | null // probe round-trip in ms
  checkedAt: string // "HH:mm"
}

function StatusDot({ status }: { status: Status }) {
  const color =
    status === "ready" ? C.accent : status === "down" ? C.danger : C.faintText
  return <Text font={13} foregroundStyle={color} fontWeight="bold">{"\u25CF"}</Text>
}

function StatusText({ status }: { status: Status }) {
  const label =
    status === "ready" ? "在线" : status === "down" ? "离线" : "检测中"
  return (
    <Text font={9} foregroundStyle={C.secondaryText} lineLimit={1}>
      {label}
    </Text>
  )
}

/** Top row: brand on the left, reachability status on the right. */
function Header({ status }: { status: Status }) {
  return (
    <HStack spacing={4}>
      <Image
        systemName="laptopcomputer.and.iphone"
        resizable
        scaleToFit
        frame={{ width: 13, height: 13 }}
        foregroundStyle={C.icon}
      />
      <Text font={11} fontWeight="bold" foregroundStyle={C.primaryText} lineLimit={1}>
        ZCode
      </Text>
      <Spacer />
      <HStack spacing={2}>
        <StatusDot status={status} />
        <StatusText status={status} />
      </HStack>
    </HStack>
  )
}

function latencyText(info: Info): string {
  if (info.status === "ready" && info.latency != null) return `${info.latency} ms`
  return info.status === "down" ? "连接失败" : "检测中"
}

function latencyColor(info: Info): DynamicShapeStyle {
  if (info.status === "ready") return C.accent
  return info.status === "down" ? C.danger : C.faintText
}

/** Probe meta: round-trip latency + last-check time. */
function MetaLine({ info }: { info: Info }) {
  return (
    <HStack spacing={3}>
      <Image
        systemName="bolt.fill"
        resizable
        scaleToFit
        frame={{ width: 8, height: 8 }}
        foregroundStyle={latencyColor(info)}
      />
      <Text font={9} monospacedDigit fontWeight="semibold" foregroundStyle={latencyColor(info)} lineLimit={1}>
        {latencyText(info)}
      </Text>
      <Text font={9} foregroundStyle={C.faintText} lineLimit={1}>
        {`· ${info.checkedAt} 检测`}
      </Text>
    </HStack>
  )
}

/** Full-width capsule that anchors the bottom of the panel. */
function ConnectButton() {
  return (
    <HStack
      frame={{ maxWidth: "infinity" }}
      padding={{ top: 7, bottom: 7 }}
      background={{ style: C.accentBg, shape: "capsule" }}
    >
      <Spacer />
      <Image
        systemName="bolt.horizontal.circle.fill"
        resizable
        scaleToFit
        frame={{ width: 12, height: 12 }}
        foregroundStyle={C.accent}
      />
      <Text font={11} fontWeight="bold" foregroundStyle={C.accent}>
        连接设备
      </Text>
      <Spacer />
    </HStack>
  )
}

const PANEL_PADDING = { top: 12, leading: 14, trailing: 14, bottom: 12 }

export function SmallPanel({ info }: { info: Info }) {
  const url = getConnectionURL()
  const device = getDeviceName(url)
  const host = getHost(url)
  const version = getAppVersion(url)

  return (
    <VStack
      alignment="leading"
      spacing={5}
      padding={PANEL_PADDING}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={{ style: PANEL_BG, shape: { type: "rect", cornerRadius: 22 } }}
    >
      <Header status={info.status} />
      <Spacer />
      {/* Identity block */}
      <Text font={15} fontWeight="bold" foregroundStyle={C.primaryText} lineLimit={1} minScaleFactor={0.7}>
        {device}
      </Text>
      <Text font={10} foregroundStyle={C.secondaryText} lineLimit={1}>
        {version ? `${host} · v${version}` : host}
      </Text>
      <MetaLine info={info} />
      <ConnectButton />
    </VStack>
  )
}

export function MediumPanel({ info }: { info: Info }) {
  const url = getConnectionURL()
  const device = getDeviceName(url)
  const host = getHost(url)
  const version = getAppVersion(url)

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={PANEL_PADDING}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={{ style: PANEL_BG, shape: { type: "rect", cornerRadius: 22 } }}
    >
      <Header status={info.status} />
      <Spacer />
      {/* Middle band: identity on the left, probe stats on the right */}
      <HStack>
        <VStack alignment="leading" spacing={3}>
          <Text font={17} fontWeight="bold" foregroundStyle={C.primaryText} lineLimit={1} minScaleFactor={0.7}>
            {device}
          </Text>
          <Text font={10} foregroundStyle={C.secondaryText} lineLimit={1}>
            {version ? `${host} · v${version}` : host}
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={3}>
          <HStack spacing={3}>
            <Image
              systemName="bolt.fill"
              resizable
              scaleToFit
              frame={{ width: 9, height: 9 }}
              foregroundStyle={latencyColor(info)}
            />
            <Text font={12} monospacedDigit fontWeight="bold" foregroundStyle={latencyColor(info)} lineLimit={1}>
              {latencyText(info)}
            </Text>
          </HStack>
          <HStack spacing={3}>
            <Image
              systemName="clock"
              resizable
              scaleToFit
              frame={{ width: 9, height: 9 }}
              foregroundStyle={C.faintText}
            />
            <Text font={9} monospacedDigit foregroundStyle={C.faintText} lineLimit={1}>
              {`${info.checkedAt} 检测`}
            </Text>
          </HStack>
        </VStack>
      </HStack>
      <Spacer />
      <ConnectButton />
    </VStack>
  )
}

function WidgetView({ info }: { info: Info }) {
  // Tapping the panel runs the script, opening the in-app remote page.
  const scheme = Script.createRunURLScheme("ZCode Remote")

  if (Widget.family === "systemSmall") {
    return (
      <VStack widgetURL={scheme} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <SmallPanel info={info} />
      </VStack>
    )
  }
  return (
    <Link url={scheme}>
      <MediumPanel info={info} />
    </Link>
  )
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  return `${h}:${m}`
}

async function present() {
  // Lightweight reachability probe; also measures round-trip latency.
  // The probe is time-boxed: if the desktop is unreachable, a hanging
  // request would otherwise block Widget.present and leave the widget blank.
  let status: Status = "checking"
  let latency: number | null = null
  const t0 = Date.now()
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("probe timeout")), 5000)
    )
    const res = await Promise.race([fetch(getConnectionURL(), { method: "GET" }), timeout])
    latency = Date.now() - t0
    status = res.ok ? "ready" : "down"
  } catch {
    status = "down"
  }
  const info: Info = { status, latency, checkedAt: formatTime(new Date()) }
  Widget.present(<WidgetView info={info} />, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 30 * 60 * 1000) },
  })
}

// Swallow rejections so importing this module (e.g. in previews) never crashes.
present().catch(() => {})
