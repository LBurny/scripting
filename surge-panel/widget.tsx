// Surge Panel 桌面小组件：显示实时上下行速率 + 出站模式。
// 复用脚本已保存的实例配置（在面板「设置 → 实例」里添加过即可，小组件读取同一份 Storage）。
// 小组件由系统定时刷新（一般几分钟一次），显示的是刷新时刻的快照，不是实时数据。
import {
  Circle,
  HStack,
  Image,
  Rectangle,
  Spacer,
  Text,
  VStack,
  Widget,
} from "scripting"
import type { Color, VirtualNode } from "scripting"
import { loadInstanceState, instanceToConfig, instanceIsReady, EMPTY_INSTANCE, findInstance } from "./lib/instances"
import { getTraffic, getOutboundMode, type TrafficSnapshot } from "./lib/surgeApi"

type SpeedParts = { value: string; unit: string }

type WidgetData = {
  instanceName: string
  up: number
  down: number
  mode: string
  error?: string
  updatedAt: Date
}

function activeInstance() {
  const { instances, activeId } = loadInstanceState()
  return findInstance(instances, activeId) ?? instances[0] ?? EMPTY_INSTANCE
}

function splitSpeed(bps: number): SpeedParts {
  if (bps < 1024) return { value: String(Math.round(bps)), unit: "B/s" }
  if (bps < 1024 * 1024) return { value: (bps / 1024).toFixed(1), unit: "KB/s" }
  if (bps < 1024 * 1024 * 1024) return { value: (bps / 1024 / 1024).toFixed(2), unit: "MB/s" }
  return { value: (bps / 1024 / 1024 / 1024).toFixed(2), unit: "GB/s" }
}

function totalSpeeds(t: TrafficSnapshot | null): { up: number; down: number } {
  if (!t) return { up: 0, down: 0 }
  let up = 0
  let down = 0
  for (const entry of Object.values(t.connector ?? {})) {
    up += entry.outCurrentSpeed ?? 0
    down += entry.inCurrentSpeed ?? 0
  }
  return { up, down }
}

async function loadData(): Promise<WidgetData> {
  const inst = activeInstance()
  const updatedAt = new Date()
  if (!instanceIsReady(inst)) {
    return { instanceName: inst.name, up: 0, down: 0, mode: "—", error: "未配置实例：请先在面板里添加", updatedAt }
  }
  const config = instanceToConfig(inst)
  try {
    const [traffic, mode] = await Promise.all([
      getTraffic(config),
      getOutboundMode(config).then((m) => String((m as { mode?: string }).mode ?? "—")).catch(() => "—"),
    ])
    const { up, down } = totalSpeeds(traffic)
    return { instanceName: inst.name, up, down, mode, updatedAt }
  } catch (e) {
    return { instanceName: inst.name, up: 0, down: 0, mode: "—", error: String(e).slice(0, 60), updatedAt }
  }
}

function fmtTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

function StatusDot({ ok }: { ok: boolean }) {
  return <Circle fill={ok ? "systemGreen" : "systemRed"} frame={{ width: 7, height: 7 }} />
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <Text
      font={10}
      fontWeight="bold"
      foregroundStyle="systemBlue"
      padding={{ horizontal: 7, vertical: 2.5 }}
      background="rgba(10,132,255,0.14)"
      clipShape="capsule"
    >
      {mode}
    </Text>
  )
}

function Header({ name, mode, ok }: { name: string; mode: string; ok: boolean }) {
  return (
    <HStack spacing={6}>
      <StatusDot ok={ok} />
      <Text font={13} fontWeight="semibold" lineLimit={1} minScaleFactor={0.8}>{name}</Text>
      <Spacer />
      <ModeBadge mode={mode} />
    </HStack>
  )
}

function SpeedBlock({
  icon,
  tint,
  label,
  speed,
  valueSize,
  align,
}: {
  icon: string
  tint: Color
  label: string
  speed: SpeedParts
  valueSize: number
  align: "leading" | "trailing"
}) {
  return (
    <VStack alignment={align} spacing={2} frame={{ maxWidth: "infinity", alignment: align }}>
      <HStack spacing={4}>
        <Image systemName={icon} font={12} foregroundStyle={tint} />
        <Text font={11} fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>{label}</Text>
      </HStack>
      <HStack spacing={3} alignment="firstTextBaseline">
        <Text font={valueSize} fontWeight="bold" monospacedDigit lineLimit={1} minScaleFactor={0.6}>
          {speed.value}
        </Text>
        <Text
          font={Math.max(11, Math.round(valueSize * 0.4))}
          fontWeight="semibold"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
        >
          {speed.unit}
        </Text>
      </HStack>
    </VStack>
  )
}

function Footer({ total, updatedAt }: { total: SpeedParts | null; updatedAt: Date }) {
  return (
    <VStack spacing={7}>
      <Rectangle fill="rgba(128,128,128,0.28)" frame={{ height: 0.5, maxWidth: "infinity" }} />
      <HStack>
        {total ? (
          <Text font={10} foregroundStyle="secondaryLabel" monospacedDigit>
            合计 {total.value} {total.unit}
          </Text>
        ) : (
          <Text font={10} foregroundStyle="secondaryLabel">连接异常</Text>
        )}
        <Spacer />
        <Text font={10} foregroundStyle="tertiaryLabel" monospacedDigit>
          更新 {fmtTime(updatedAt)}
        </Text>
      </HStack>
    </VStack>
  )
}

function ErrorBody({ error }: { error: string }) {
  return (
    <VStack alignment="center" spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Image systemName="exclamationmark.triangle.fill" font={22} foregroundStyle="systemOrange" />
      <Text font={13} fontWeight="semibold">连接失败</Text>
      <Text font={11} foregroundStyle="secondaryLabel" lineLimit={3} multilineTextAlignment="center">{error}</Text>
      <Text font={10} foregroundStyle="tertiaryLabel">请到面板「设置 → 实例」检查地址与 Key</Text>
    </VStack>
  )
}

function MediumBody({ data }: { data: WidgetData }) {
  const down = splitSpeed(data.down)
  const up = splitSpeed(data.up)
  const total = splitSpeed(data.down + data.up)
  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Header name={data.instanceName} mode={data.mode} ok={!data.error} />
      <Spacer minLength={10} />
      {data.error ? (
        <ErrorBody error={data.error} />
      ) : (
        <HStack alignment="top">
          <SpeedBlock icon="arrow.down" tint="systemGreen" label="下载" speed={down} valueSize={28} align="leading" />
          <SpeedBlock icon="arrow.up" tint="systemOrange" label="上传" speed={up} valueSize={28} align="trailing" />
        </HStack>
      )}
      <Spacer minLength={10} />
      <Footer total={data.error ? null : total} updatedAt={data.updatedAt} />
    </VStack>
  )
}

function SmallBody({ data }: { data: WidgetData }) {
  const down = splitSpeed(data.down)
  const up = splitSpeed(data.up)
  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Header name={data.instanceName} mode={data.mode} ok={!data.error} />
      <Spacer minLength={6} />
      {data.error ? (
        <ErrorBody error={data.error} />
      ) : (
        <VStack alignment="leading" spacing={2}>
          <SpeedBlock icon="arrow.down" tint="systemGreen" label="下载" speed={down} valueSize={26} align="leading" />
          <SpeedBlock icon="arrow.up" tint="systemOrange" label="上传" speed={up} valueSize={17} align="leading" />
        </VStack>
      )}
      <Spacer minLength={6} />
    </VStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const family = Widget.family
  return (
    <VStack alignment="leading" spacing={0} padding={16} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {family === "systemSmall" ? <SmallBody data={data} /> : <MediumBody data={data} />}
    </VStack>
  )
}

loadData().then((data) => {
  Widget.present(
    <WidgetView data={data} />,
    { reloadPolicy: { policy: "after", date: new Date(Date.now() + 2 * 60 * 1000) } },
  )
})

// 以下默认导出仅供 scripting-ts preview_ui 预览使用，不影响小组件运行
function PreviewFrame({ width, height, children }: { width: number; height: number; children: VirtualNode }) {
  return (
    <VStack
      frame={{ width, height }}
      background={{ style: "white", shape: { type: "rect", cornerRadius: 22, style: "continuous" } }}
    >
      <VStack alignment="leading" spacing={0} padding={16} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {children}
      </VStack>
    </VStack>
  )
}

export default function Preview() {
  const data: WidgetData = {
    instanceName: "本机",
    up: 184532,
    down: 2380000,
    mode: "rule",
    updatedAt: new Date(),
  }
  return (
    <VStack spacing={24} padding={24} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <PreviewFrame width={329} height={155}>
        <MediumBody data={data} />
      </PreviewFrame>
      <PreviewFrame width={158} height={158}>
        <SmallBody data={data} />
      </PreviewFrame>
      <PreviewFrame width={329} height={155}>
        <MediumBody data={{ ...data, down: 0, up: 0, error: "连接超时：ETIMEDOUT 192.168.1.1:6171" }} />
      </PreviewFrame>
    </VStack>
  )
}