// 总览 Tab
import {
  AreaChart,
  Chart,
  gradient,
  HStack,
  Image,
  LineChart,
  Script,
  ScrollView,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { PanelCard } from "../components/PanelCard"
import { StatCard } from "../components/StatCard"
import { activeInstance, getState, needsSetup, openRequestsSegment, openTrafficTab, refreshNow, savePrefs, useStore } from "../lib/store"
import {
  evaluateScript,
  getDns,
  getEvents,
  getFeature,
  setFeature,
  FEATURE_LABELS,
  type FeatureKey,
  type SurgeConfig,
  type SurgeEvent,
} from "../lib/surgeApi"
import { InstancesView } from "./InstancesView"
import {
  buildInfo,
  collectRecordAddresses,
  countFakeIps,
  formatBytesParts,
  formatClock,
  formatEventTime,
  formatSpeedParts,
  formatUptime,
  gaugeValue,
  displayHostPort,
  displayPrimaryAddrs,
  parsePrimaryAddresses,
} from "../lib/metrics"
import { connectErrorText, METRICS_HINT, UI, cardBackground } from "../lib/ui"
import { MemoryDiagView } from "./MemoryDiagView"

/** 图表降采样到最多 n 个点 */
export function downsample<T>(pts: T[], n: number): T[] {
  if (pts.length <= n) return pts
  const step = pts.length / n
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * step)])
  out.push(pts[pts.length - 1])
  return out
}

/** bytes/s → KB/s，一位小数 */
function toKbps(bytesPerSec: number): number {
  return Math.round((bytesPerSec ?? 0) / 102.4) / 10
}

/** Y 轴上界：1/2/5×10^n，并留约 15% 余量。速率不能为负，下界固定 0。 */
function niceUpper(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 10
  const padded = n * 1.15
  const mag = 10 ** Math.floor(Math.log10(padded))
  const norm = padded / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

const LINE_STYLE = { lineWidth: 2.5, lineCap: "round" as const, lineJoin: "round" as const }

// 事件 / 功能开关 / Fake-IP 计数 / 本机地址变化很慢，不跟随每次采样刷新
const SLOW_REFRESH_MS = 30_000

export function OverviewView() {
  const state = useStore()
  const inst = activeInstance()
  const [showDiag, setShowDiag] = useState(false)
  const [showInst, setShowInst] = useState(false)
  const [events, setEvents] = useState<SurgeEvent[] | null>(null)
  const [features, setFeatures] = useState<Record<FeatureKey, boolean> | null>(null)
  const [fakeIpCount, setFakeIpCount] = useState<number | null>(null)
  const [localAddrs, setLocalAddrs] = useState<{ ipv4?: string; ipv6?: string }>({})

  const mem = state.samples ? gaugeValue(state.samples, "surge_memory_bytes") : null
  const uptime = state.samples ? gaugeValue(state.samples, "surge_uptime_seconds") : null
  const active = state.samples ? gaugeValue(state.samples, "surge_active_requests") : null
  const dns = state.samples ? gaugeValue(state.samples, "surge_dns_cache_entries") : null
  const bans = state.metricsAvailable === false ? null : state.samples ? gaugeValue(state.samples, "surge_active_bans") : null
  const info = state.metricsAvailable === false ? null : state.samples ? buildInfo(state.samples) : null
  const noMetrics = state.metricsAvailable === false
  const peakIn = state.peakSpeeds.inSpeed
  const peakOut = state.peakSpeeds.outSpeed
  const memParts = mem !== null ? formatBytesParts(mem) : null
  const downParts = state.running ? formatSpeedParts(state.speeds.inSpeed) : null
  const upParts = state.running ? formatSpeedParts(state.speeds.outSpeed) : null
  const peakInParts = peakIn > 0 ? formatSpeedParts(peakIn) : null
  const peakOutParts = peakOut > 0 ? formatSpeedParts(peakOut) : null
  const isHome = Script.env === "home_screen"
  const setup = needsSetup()

  // 慢数据：事件、功能开关、DNS（只为 Fake-IP 计数）、$network 本机地址。
  // 这些请求不轻（getDns 是整份缓存），不跟随 5 秒采样，只在总览可见时每 30 秒拉一轮。
  // 响应落地前校验 config 未变，避免切实例后旧响应覆盖新实例数据。
  function loadSlowData(cfg: SurgeConfig) {
    const fresh = () => getState().config === cfg
    getEvents(cfg)
      .then((r) => {
        if (fresh()) setEvents(r.events.slice().reverse())
      })
      .catch(() => {
        if (fresh()) setEvents(null)
      })
    Promise.all(
      (Object.keys(FEATURE_LABELS) as FeatureKey[]).map(async (k) => {
        const r = await getFeature(cfg, k)
        return [k, r.enabled] as const
      })
    )
      .then((pairs) => {
        if (fresh()) setFeatures(Object.fromEntries(pairs) as Record<FeatureKey, boolean>)
      })
      .catch(() => {
        if (fresh()) setFeatures(null)
      })
    getDns(cfg)
      .then((r) => {
        if (!fresh()) return
        const addrs = [
          ...collectRecordAddresses(r.local),
          ...collectRecordAddresses(r.dnsCache),
        ]
        setFakeIpCount(countFakeIps(addrs))
      })
      .catch(() => {
        if (fresh()) setFakeIpCount(null)
      })
    evaluateScript(cfg, "$done($network)", "generic", 3)
      .then((raw) => {
        if (fresh()) setLocalAddrs(parsePrimaryAddresses(raw))
      })
      .catch(() => {
        if (fresh()) setLocalAddrs({})
      })
  }

  const overviewVisible = state.visibleTab === 0

  useEffect(() => {
    if (setup) {
      setEvents(null)
      setFeatures(null)
      setFakeIpCount(null)
      setLocalAddrs({})
      return
    }
    if (!overviewVisible) return
    const cfg = state.config
    loadSlowData(cfg)
    const id = setInterval(() => loadSlowData(cfg), SLOW_REFRESH_MS)
    return () => clearInterval(id)
  }, [state.config, setup, overviewVisible])

  async function toggleFeature(k: FeatureKey, v: boolean) {
    setFeatures((f) => (f ? { ...f, [k]: v } : f))
    try {
      await setFeature(state.config, k, v)
    } catch {
      try {
        const r = await getFeature(state.config, k)
        setFeatures((f) => (f ? { ...f, [k]: r.enabled } : f))
      } catch {
        // 保持乐观值
      }
    }
  }

  async function reload() {
    if (needsSetup()) return
    loadSlowData(state.config)
    await refreshNow().catch(() => {})
  }

  const chartPts = downsample(state.history, 60)
  const memValues = chartPts.map((p) => Math.round((p.mem / (1024 * 1024)) * 10) / 10)
  const memYMax = niceUpper(Math.max(0, ...memValues))
  const marks = chartPts.map((p, i) => ({
    label: new Date(p.t),
    value: memValues[i],
    // monotone 保单调、不过冲；catmullRom 会在尖峰前插出负值
    interpolationMethod: "monotone" as const,
    foregroundStyle: gradient("linear", {
      colors: ["rgba(88,86,214,0.35)", "rgba(88,86,214,0.02)"],
      startPoint: "top" as const,
      endPoint: "bottom" as const,
    }),
  }))

  // 实时速率双线（KB/s）：foregroundStyleBy 是官方的多序列写法；
  // 两个 LineChart 子组件会被串成一条折线（实测出现连接线伪影），必须用单 LineChart + 序列编码
  const speedMarks = state.speedHistory.flatMap((p) => [
    {
      label: new Date(p.t),
      value: toKbps(p.inSpeed),
      interpolationMethod: "monotone" as const,
      lineStyle: LINE_STYLE,
      foregroundStyleBy: { value: "下载", label: "下载" },
    },
    {
      label: new Date(p.t),
      value: toKbps(p.outSpeed),
      interpolationMethod: "monotone" as const,
      lineStyle: LINE_STYLE,
      foregroundStyleBy: { value: "上传", label: "上传" },
    },
  ])
  const speedYMax = niceUpper(
    Math.max(0, ...state.speedHistory.flatMap((p) => [toKbps(p.inSpeed), toKbps(p.outSpeed)]))
  )

  const latestEvent = events && events.length > 0 ? events[0] : null
  const hideAddresses = state.prefs.hideAddresses
  const endpointText = displayHostPort(inst.host, inst.port, hideAddresses)
  const localAddrText = displayPrimaryAddrs(localAddrs, hideAddresses)
  const activityBadge =
    state.failedRecent > 0 || state.rejectedRecent > 0
      ? `失败 ${state.failedRecent} · 拒绝 ${state.rejectedRecent}`
      : undefined
  const dnsParts: string[] = []
  if (fakeIpCount != null && fakeIpCount > 0) dnsParts.push(`Fake-IP ${fakeIpCount}`)
  if (bans !== null) dnsParts.push(`活动封禁 ${bans}`)
  const dnsSubtitle = dnsParts.length > 0 ? dnsParts.join(" · ") : "缓存条目"

  return (
    <ScrollView
      axes="vertical"
      refreshable={reload}
      sheet={{
        isPresented: showDiag || showInst,
        onChanged: (v: boolean) => {
          if (!v) {
            setShowDiag(false)
            setShowInst(false)
          }
        },
        content: showDiag ? (
          <MemoryDiagView />
        ) : (
          <InstancesView startAdding={setup && state.instances.length === 0} />
        ),
      }}
    >
      <VStack alignment="leading" spacing={UI.pageSpacing} padding={UI.pagePadding}>
        {/* 品牌头（不是页名） */}
        <HStack>
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={8} onTapGesture={() => setShowInst(true)}>
              <Text font={isHome ? 22 : 28} fontWeight="bold">{inst.name}</Text>
              <Image systemName="chevron.up.chevron.down" font={12} foregroundStyle="secondaryLabel" />
              {setup ? (
                <HStack spacing={4}>
                  <Image systemName="circle.fill" foregroundStyle="secondaryLabel" font={8} />
                  <Text font={13} foregroundStyle="secondaryLabel">待配置</Text>
                </HStack>
              ) : state.error ? (
                <HStack spacing={4}>
                  <Image systemName="circle.fill" foregroundStyle="systemRed" font={8} />
                  <Text font={13} foregroundStyle="systemRed">未连接</Text>
                </HStack>
              ) : state.running ? (
                <HStack spacing={4}>
                  <Image systemName="circle.fill" foregroundStyle="systemGreen" font={8} />
                  <Text font={13} foregroundStyle="systemGreen">运行中</Text>
                </HStack>
              ) : (
                <HStack spacing={4}>
                  <Image systemName="circle.fill" foregroundStyle="secondaryLabel" font={8} />
                  <Text font={13} foregroundStyle="secondaryLabel">连接中</Text>
                </HStack>
              )}
            </HStack>
            <HStack
              spacing={6}
              onTapGesture={
                setup
                  ? undefined
                  : () => savePrefs({ ...state.prefs, hideAddresses: !hideAddresses })
              }
            >
              <Text font={13} foregroundStyle="secondaryLabel">
                {setup
                  ? "点按添加 Surge HTTP API 实例"
                  : state.updatedAt
                    ? `更新于 ${formatClock(state.updatedAt)} · ${endpointText}${localAddrText ? ` · ${localAddrText}` : ""}`
                    : "正在连接…"}
              </Text>
              {setup ? null : (
                <Image
                  systemName={hideAddresses ? "eye.slash" : "eye"}
                  font={11}
                  foregroundStyle="tertiaryLabel"
                />
              )}
            </HStack>
          </VStack>
          <Spacer />
          {info ? (
            <VStack alignment="trailing" spacing={2}>
              <Text font={13} foregroundStyle="secondaryLabel">{`v${info.version}`}</Text>
              <Text font={UI.captionFont} foregroundStyle="tertiaryLabel">{`Build ${info.build}`}</Text>
            </VStack>
          ) : inst.version ? (
            <Text font={13} foregroundStyle="secondaryLabel">{`v${inst.version}`}</Text>
          ) : null}
        </HStack>

        {setup ? (
          <PanelCard>
            <Text font={UI.titleFont} fontWeight="semibold">开始使用</Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              首次安装不会自动连接。添加本机或网关的 Surge HTTP API，并填写 Key 后才会拉取数据。
            </Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              本机默认用 http（Surge 默认 http-api-tls = false）。若选 https，证书由 MITM CA 自签，面板会跳过系统链校验。
            </Text>
            <HStack spacing={8} padding={{ top: 4 }} onTapGesture={() => setShowInst(true)}>
              <Image systemName="plus.circle.fill" foregroundStyle="systemBlue" font={18} />
              <Text font={15} fontWeight="semibold" foregroundStyle="systemBlue">
                {state.instances.length === 0 ? "添加实例" : "去完善实例"}
              </Text>
            </HStack>
          </PanelCard>
        ) : null}

        {!setup && noMetrics ? (
          <Text font={13} foregroundStyle="secondaryLabel">{METRICS_HINT}</Text>
        ) : null}

        {!setup && state.error ? (
          <Text font={13} foregroundStyle="systemRed">
            {connectErrorText(state.error)}
          </Text>
        ) : null}

        {!setup && features ? (
          <PanelCard spacing={8}>
            <Text font={UI.titleFont} fontWeight="semibold">能力</Text>
            {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((k) => (
              <Toggle
                key={k}
                title={FEATURE_LABELS[k]}
                value={features[k]}
                onChanged={(v: boolean) => toggleFeature(k, v)}
              />
            ))}
          </PanelCard>
        ) : null}

        {!setup ? (
          <>
        <VStack spacing={12}>
          <HStack spacing={12}>
            <StatCard
              icon="memorychip.fill"
              iconColor="systemPurple"
              title="内存"
              value={memParts ? memParts.value : "—"}
              unit={memParts?.unit}
              subtitle={noMetrics ? "需 iOS 5.22+ / Mac 6.9+" : "点按查看诊断"}
              onTap={() => setShowDiag(true)}
            />
            <StatCard
              icon="clock.fill"
              iconColor="systemGreen"
              title="运行时长"
              value={uptime !== null ? formatUptime(uptime) : "—"}
              subtitle={info ? `Surge ${info.version}` : inst.version ? `Surge ${inst.version}` : undefined}
            />
          </HStack>
          <HStack spacing={12}>
            <StatCard
              icon="arrow.down.circle.fill"
              iconColor="systemBlue"
              title="实时下载"
              value={downParts ? downParts.value : "—"}
              unit={downParts?.unit}
              subtitle={peakInParts ? `峰值 ${peakInParts.value} ${peakInParts.unit}` : "全部网络接口"}
              onTap={() => openTrafficTab()}
            />
            <StatCard
              icon="arrow.up.circle.fill"
              iconColor="systemGreen"
              title="实时上传"
              value={upParts ? upParts.value : "—"}
              unit={upParts?.unit}
              subtitle={peakOutParts ? `峰值 ${peakOutParts.value} ${peakOutParts.unit}` : "全部网络接口"}
              onTap={() => openTrafficTab()}
            />
          </HStack>
          <HStack spacing={12}>
            <StatCard
              icon="link.circle.fill"
              iconColor="systemOrange"
              title="活动连接"
              value={active !== null ? String(active) : "—"}
              badge={activityBadge}
              subtitle="HTTP 请求"
              onTap={() => openRequestsSegment("active")}
            />
            <StatCard
              icon="server.rack"
              iconColor="systemTeal"
              title="DNS 缓存"
              value={dns !== null ? String(dns) : "—"}
              subtitle={dnsSubtitle}
              onTap={() => openRequestsSegment("dns")}
            />
          </HStack>
        </VStack>

        {/* 实时速率曲线（上传/下载） */}
        <PanelCard>
          <HStack>
            <Text font={UI.titleFont} fontWeight="semibold">实时速率</Text>
            <Spacer />
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel">KB/s · 1 秒采样 · 近 1 分钟</Text>
          </HStack>
          {state.traffic && speedMarks.length >= 4 ? (
            <Chart
              frame={{ height: 168 }}
              chartYScale={{ domain: { from: 0, to: speedYMax }, type: "linear" }}
              chartXAxis={{ valueLabel: { format: "time" } }}
              chartLegend={{ position: "bottom", spacing: 6 }}
              chartForegroundStyleScale={{
                "下载": "systemBlue",
                "上传": "systemGreen",
              }}
            >
              <LineChart marks={speedMarks} />
            </Chart>
          ) : (
            <Text font={13} foregroundStyle="secondaryLabel">采样中，稍后展示速率曲线…</Text>
          )}
        </PanelCard>

        {/* 内存趋势图 */}
        <PanelCard>
          <HStack>
            <Text font={UI.titleFont} fontWeight="semibold">内存历史</Text>
            <Spacer />
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel">
              {noMetrics ? "当前版本无 /metrics" : `${state.history.length} 个采样点`}
            </Text>
          </HStack>
          {noMetrics ? (
            <Text font={13} foregroundStyle="secondaryLabel">{METRICS_HINT}</Text>
          ) : marks.length >= 2 ? (
            <Chart
              frame={{ height: 150 }}
              chartYScale={{ domain: { from: 0, to: memYMax }, type: "linear" }}
            >
              <AreaChart marks={marks} />
            </Chart>
          ) : (
            <Text font={13} foregroundStyle="secondaryLabel">采样中，稍后展示趋势…</Text>
          )}
        </PanelCard>

        {/* 事件摘要：放底部，点按进入请求 Tab 事件分段 */}
        <HStack
          spacing={10}
          padding={UI.cardPadding}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          background={cardBackground()}
          onTapGesture={() => openRequestsSegment("events")}
        >
          <Image
            systemName={latestEvent ? "bell.fill" : "bell"}
            foregroundStyle={latestEvent ? "systemOrange" : "secondaryLabel"}
            font={16}
          />
          <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font={UI.titleFont} fontWeight="semibold">
              {events === null ? "事件" : events.length === 0 ? "暂无事件" : `${events.length} 条事件`}
            </Text>
            <Text font={UI.captionFont} foregroundStyle="secondaryLabel" lineLimit={2}>
              {latestEvent
                ? `${formatEventTime(latestEvent.date)} · ${latestEvent.content ?? latestEvent.identifier}`
                : "点按查看事件中心"}
            </Text>
          </VStack>
          <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font={12} />
        </HStack>
          </>
        ) : null}
      </VStack>
    </ScrollView>
  )
}
