// 内存诊断 sheet：趋势图 + 窗口统计 + 判断；事件请到「请求 → 事件」
import {
  AreaChart,
  Button,
  Chart,
  gradient,
  HStack,
  Image,
  LineChart,
  NavigationStack,
  Picker,
  ScrollView,
  Spacer,
  Text,
  useState,
  VStack,
} from "scripting"
import { PanelCard } from "../components/PanelCard"
import { openRequestsSegment, savePrefs, useStore } from "../lib/store"
import { reloadProfile } from "../lib/surgeApi"
import {
  analyzeMemoryTrend,
  formatBytes,
  formatMemSlope,
  gaugeValue,
  historyForRange,
  MEM_RANGE_OPTIONS,
  type MemRangeMin,
} from "../lib/metrics"
import { METRICS_HINT, UI } from "../lib/ui"
import { downsample } from "./OverviewView"

export function MemoryDiagView() {
  const state = useStore()
  const [confirmReload, setConfirmReload] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const rangeMin = (MEM_RANGE_OPTIONS.some((o) => o.minutes === state.prefs.memRangeMin)
    ? state.prefs.memRangeMin
    : 60) as MemRangeMin
  const rangeMs = rangeMin * 60 * 1000
  const windowPts = historyForRange(state.history, state.memLong, rangeMs)
  const trend = analyzeMemoryTrend(windowPts, {
    recentMs: Math.min(20 * 60 * 1000, rangeMs),
    intervalSec: state.prefs.intervalSec,
  })
  const mem = state.samples ? gaugeValue(state.samples, "surge_memory_bytes") : null
  const currentMB = mem !== null ? mem / (1024 * 1024) : trend.currentMB

  const pts = downsample(windowPts, 80)
  const marks = pts.map((p) => ({
    label: new Date(p.t),
    value: Math.round((p.mem / (1024 * 1024)) * 10) / 10,
    interpolationMethod: "monotone" as const,
  }))
  const memYMax = Math.max(10, Math.max(0, ...marks.map((m) => m.value)) * 1.15)

  async function doReload() {
    try {
      await reloadProfile(state.config)
      setActionMsg("配置已重新加载")
    } catch (e) {
      setActionMsg(`重载失败：${String(e)}`)
    }
  }

  return (
    <NavigationStack>
      <ScrollView
        axes="vertical"
        navigationTitle="内存诊断"
        confirmationDialog={{
          isPresented: confirmReload,
          onChanged: setConfirmReload,
          title: "重新加载配置？",
          actions: <Button title="重新加载" action={doReload} />,
        }}
      >
        <VStack alignment="leading" spacing={UI.pageSpacing} padding={UI.pagePadding}>
          {state.metricsAvailable === false ? (
            <PanelCard>
              <Text font={UI.titleFont} fontWeight="semibold">当前版本没有内存指标</Text>
              <Text font={13} foregroundStyle="secondaryLabel">{METRICS_HINT}</Text>
              <Text font={13} foregroundStyle="secondaryLabel">
                TestFlight 以及即将发布的 iOS 5.22 / Mac 6.9 才有 Prometheus /metrics。流量、策略、请求仍可用。
              </Text>
              <Button title="查看事件" systemImage="bell" action={() => openRequestsSegment("events")} />
            </PanelCard>
          ) : null}
          {state.metricsAvailable !== false ? (
            <>
          <PanelCard>
            <HStack>
              <Text font={UI.titleFont} fontWeight="semibold">内存占用历史</Text>
              <Spacer />
              <Text font={UI.captionFont} foregroundStyle="secondaryLabel">
                {trend.historyMin > 0
                  ? `已有 ${trend.historyMin >= 60 ? `${(trend.historyMin / 60).toFixed(1)} 小时` : `${Math.max(1, Math.round(trend.historyMin))} 分钟`} · ${trend.samples} 点`
                  : "采样中"}
              </Text>
            </HStack>
            <Picker
              title="查看范围"
              value={String(rangeMin)}
              onChanged={(v: string) =>
                savePrefs({ ...state.prefs, memRangeMin: Number(v) as MemRangeMin })
              }
            >
              {MEM_RANGE_OPTIONS.map((o) => (
                <Text key={o.tag} tag={o.tag}>{o.label}</Text>
              ))}
            </Picker>
            {marks.length >= 2 ? (
              <Chart
                frame={{ height: 180 }}
                chartYScale={{ domain: { from: 0, to: memYMax }, type: "linear" }}
                chartXAxis={{ valueLabel: { format: "time" } }}
              >
                <LineChart marks={marks.map((m) => ({ ...m, foregroundStyle: "systemPurple" as const }))} />
                <AreaChart
                  marks={marks.map((m) => ({
                    ...m,
                    foregroundStyle: gradient("linear", {
                      colors: ["rgba(88,86,214,0.30)", "rgba(88,86,214,0.02)"],
                      startPoint: "top" as const,
                      endPoint: "bottom" as const,
                    }),
                  }))}
                />
              </Chart>
            ) : (
              <Text font={13} foregroundStyle="secondaryLabel">采样数据不足…</Text>
            )}
          </PanelCard>

          <PanelCard>
            <Text font={UI.titleFont} fontWeight="semibold">窗口统计</Text>
            <HStack spacing={0}>
              <DiagItem label="当前" value={currentMB > 0 ? `${currentMB.toFixed(1)} MB` : mem !== null ? formatBytes(mem) : "—"} />
              <DiagItem label="峰值" value={trend.peakMB > 0 ? `${trend.peakMB.toFixed(1)} MB` : "—"} />
              <DiagItem label="谷值" value={trend.minMB > 0 ? `${trend.minMB.toFixed(1)} MB` : "—"} />
            </HStack>
            <HStack spacing={0}>
              <DiagItem
                label="变化速率"
                value={trend.samples >= 12 ? formatMemSlope(trend.slopeMBPerMin) : "—"}
              />
              <DiagItem
                label="振幅"
                value={trend.rangeMB > 0 ? `${trend.rangeMB.toFixed(1)} MB` : trend.samples >= 12 ? "≈ 0" : "—"}
              />
              <DiagItem
                label="速率窗口"
                value={trend.windowMin > 0 ? `${Math.max(1, Math.round(trend.windowMin))} 分钟` : "—"}
              />
            </HStack>
          </PanelCard>

          <PanelCard>
            <HStack spacing={6}>
              <Image
                systemName={
                  trend.level === "warning"
                    ? "exclamationmark.triangle.fill"
                    : trend.level === "ok"
                      ? "checkmark.seal.fill"
                      : "hourglass"
                }
                foregroundStyle={
                  trend.level === "warning" ? "systemOrange" : trend.level === "ok" ? "systemGreen" : "secondaryLabel"
                }
              />
              <Text font={UI.titleFont} fontWeight="semibold">
                {trend.level === "warning" ? "检测到异常趋势" : trend.level === "ok" ? "运行正常" : "数据不足"}
              </Text>
            </HStack>
            <Text font={13} foregroundStyle="secondaryLabel">{trend.message}</Text>
            <HStack spacing={12}>
              {trend.level === "warning" ? (
                <Button title="重新加载配置" systemImage="arrow.triangle.2.circlepath" action={() => setConfirmReload(true)} />
              ) : null}
              <Button title="查看事件" systemImage="bell" action={() => openRequestsSegment("events")} />
            </HStack>
            {actionMsg ? <Text font={12} foregroundStyle="secondaryLabel">{actionMsg}</Text> : null}
          </PanelCard>
            </>
          ) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

function DiagItem({ label, value }: { label: string; value: string }) {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
      <Text font={17} fontWeight="semibold" lineLimit={1} minScaleFactor={0.7}>{value}</Text>
      <Text font={11} foregroundStyle="secondaryLabel">{label}</Text>
    </VStack>
  )
}
