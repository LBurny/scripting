// 流量 Tab：网卡 interface 与节点 connector 分层，排行取 /v1/traffic 累计
import {
  HStack,
  Image,
  Picker,
  ScrollView,
  Spacer,
  Text,
  useState,
  VStack,
  type Color,
} from "scripting"
import { GradientBar } from "../components/GradientBar"
import { PanelCard } from "../components/PanelCard"
import { StatCard } from "../components/StatCard"
import { refreshNow, useStore } from "../lib/store"
import { formatBytes, formatSpeed, formatSpeedParts, ifaceDisplayName, isDirectPolicy } from "../lib/metrics"
import { UI } from "../lib/ui"
import type { TrafficEntry } from "../lib/surgeApi"

const BAR_COLORS: [Color, Color][] = [
  ["#5E5CE6", "#64D2FF"],
  ["#0A84FF", "#64D2FF"],
  ["#30D158", "#64D2FF"],
  ["#FF9F0A", "#FFD60A"],
  ["#BF5AF2", "#FF375F"],
]

function sortedEntries(
  rec: Record<string, TrafficEntry> | undefined,
  by: "current" | "total" | "peak"
): [string, TrafficEntry][] {
  if (!rec) return []
  return Object.entries(rec).sort((a, b) => {
    const score = (e: TrafficEntry) =>
      by === "current"
        ? e.inCurrentSpeed + e.outCurrentSpeed
        : by === "peak"
          ? e.inMaxSpeed + e.outMaxSpeed
          : e.in + e.out
    return score(b[1]) - score(a[1])
  })
}

export function TrafficView() {
  const state = useStore()
  const [sortBy, setSortBy] = useState<"current" | "total" | "peak">("current")

  const interfaces = sortedEntries(state.traffic?.interface, sortBy)
  const connectors = sortedEntries(state.traffic?.connector, sortBy)
  const activeNodes = connectors.filter(
    ([, v]) => v.inCurrentSpeed + v.outCurrentSpeed > 0
  )
  const ranked = sortedEntries(state.traffic?.connector, "total")
    .map(([name, v]) => ({ name, total: v.in + v.out }))
    .filter((r) => r.total > 0)
    .slice(0, 10)
  const maxTotal = ranked.length > 0 ? ranked[0].total : 1

  const downParts = state.running ? formatSpeedParts(state.speeds.inSpeed) : null
  const upParts = state.running ? formatSpeedParts(state.speeds.outSpeed) : null

  let directBytes = 0
  let proxyBytes = 0
  for (const [name, v] of connectors) {
    const total = v.in + v.out
    if (isDirectPolicy(name)) directBytes += total
    else proxyBytes += total
  }
  const splitTotal = directBytes + proxyBytes
  const directPct = splitTotal > 0 ? Math.round((directBytes / splitTotal) * 100) : 0
  const proxyPct = splitTotal > 0 ? 100 - directPct : 0

  return (
    <ScrollView axes="vertical" refreshable={async () => { await refreshNow() }}>
      <VStack alignment="leading" spacing={UI.pageSpacing} padding={UI.pagePadding}>
        {/* 实时合计 */}
        <HStack spacing={12}>
          <StatCard
            icon="arrow.down.circle.fill"
            iconColor="systemBlue"
            title="实时下载"
            value={downParts ? downParts.value : "—"}
            unit={downParts?.unit}
            subtitle="全部网络接口"
          />
          <StatCard
            icon="arrow.up.circle.fill"
            iconColor="systemGreen"
            title="实时上传"
            value={upParts ? upParts.value : "—"}
            unit={upParts?.unit}
            subtitle="全部网络接口"
          />
        </HStack>

        {state.traffic ? (
          <PanelCard>
            <Text font={UI.titleFont} fontWeight="semibold">本次运行分流</Text>
            <HStack spacing={16} padding={{ top: 4 }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font={13} foregroundStyle="secondaryLabel">直连</Text>
                <Text font={17} fontWeight="semibold">{formatBytes(directBytes)}</Text>
                <Text font={UI.captionFont} foregroundStyle="tertiaryLabel">{`${directPct}%`}</Text>
              </VStack>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font={13} foregroundStyle="secondaryLabel">代理</Text>
                <Text font={17} fontWeight="semibold">{formatBytes(proxyBytes)}</Text>
                <Text font={UI.captionFont} foregroundStyle="tertiaryLabel">{`${proxyPct}%`}</Text>
              </VStack>
            </HStack>
          </PanelCard>
        ) : null}

        <Picker title="明细排序" pickerStyle="segmented" value={sortBy} onChanged={(v: string) => setSortBy(v as "current" | "total" | "peak")}>
          <Text tag="current">实时</Text>
          <Text tag="total">累计</Text>
          <Text tag="peak">峰值</Text>
        </Picker>

        {/* 网卡 */}
        <PanelCard spacing={12}>
          <HStack>
            <Text font={UI.titleFont} fontWeight="semibold">网卡</Text>
            <Spacer />
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel">
              {state.traffic ? `${interfaces.length} 个接口` : "未连接"}
            </Text>
          </HStack>
          {interfaces.length === 0 ? (
            <Text font={13} foregroundStyle="secondaryLabel">暂无接口数据</Text>
          ) : (
            interfaces.map(([name, v]) => {
              const ifaceLabel = ifaceDisplayName(name)
              return (
              <HStack key={name} spacing={10} padding={{ vertical: 2 }}>
                <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text font={15} lineLimit={1} minScaleFactor={0.7}>{name}</Text>
                  <Text font={UI.captionFont} foregroundStyle="secondaryLabel">
                    {`${ifaceLabel ? `${ifaceLabel} · ` : ""}累计 ↓${formatBytes(v.in)}  ↑${formatBytes(v.out)} · 峰值 ↓${formatSpeed(v.inMaxSpeed)} ↑${formatSpeed(v.outMaxSpeed)}`}
                  </Text>
                </VStack>
                <HStack spacing={4}>
                  <Image systemName="arrow.down" font={10} foregroundStyle="systemBlue" />
                  <Text font={13}>{formatSpeed(v.inCurrentSpeed)}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Image systemName="arrow.up" font={10} foregroundStyle="systemGreen" />
                  <Text font={13} foregroundStyle="secondaryLabel">{formatSpeed(v.outCurrentSpeed)}</Text>
                </HStack>
              </HStack>
              )
            })
          )}
        </PanelCard>

        {/* 活动中的节点 */}
        <PanelCard spacing={12}>
          <HStack>
            <Text font={UI.titleFont} fontWeight="semibold">活动中的节点</Text>
            <Spacer />
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel">
              {state.traffic ? `${activeNodes.length} 个正在传输` : "未连接"}
            </Text>
          </HStack>
          {activeNodes.length === 0 ? (
            <Text font={13} foregroundStyle="secondaryLabel">当前没有节点在传输</Text>
          ) : (
            activeNodes.map(([name, v]) => (
              <HStack key={name} spacing={10} padding={{ vertical: 2 }}>
                <Text font={15} lineLimit={1} minScaleFactor={0.7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {name}
                </Text>
                <VStack alignment="trailing" spacing={2}>
                  <HStack spacing={4}>
                    <Image systemName="arrow.down" font={10} foregroundStyle="systemBlue" />
                    <Text font={13}>{formatSpeed(v.inCurrentSpeed)}</Text>
                  </HStack>
                  <Text font={11} foregroundStyle="tertiaryLabel">{`累计 ${formatBytes(v.in + v.out)}`}</Text>
                </VStack>
              </HStack>
            ))
          )}
        </PanelCard>

        {/* 节点流量排行（/v1/traffic 累计） */}
        <PanelCard spacing={12}>
          <HStack>
            <Text font={UI.titleFont} fontWeight="semibold">节点流量排行</Text>
            <Spacer />
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel">本次引擎运行累计</Text>
          </HStack>
          {ranked.length === 0 ? (
            <Text font={13} foregroundStyle="secondaryLabel">暂无流量数据</Text>
          ) : (
            ranked.map((r, i) => (
              <GradientBar
                key={r.name}
                label={r.name}
                valueText={formatBytes(r.total)}
                ratio={r.total / maxTotal}
                colors={BAR_COLORS[i % BAR_COLORS.length]}
              />
            ))
          )}
        </PanelCard>
      </VStack>
    </ScrollView>
  )
}
