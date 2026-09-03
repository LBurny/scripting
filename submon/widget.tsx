// widget.tsx — submon 桌面小组件：small 单卡（最近到期）/ medium 前 3 条，点击进入 App
// 数据流同 reader：时间线内限时刷新（5s 竞速）→ 失败/超时兜底用缓存渲染

import {
  Widget, Script, VStack, HStack, Text, Image, Spacer, ProgressView,
} from "scripting"
import { loadSubs } from "./lib/subs"
import type { Sub } from "./lib/subs"
import { loadStates, refreshAll } from "./lib/store"
import type { SubState } from "./lib/store"
import { sortByExpiry, pctUsed, daysLeft, isExpired, formatBytes, formatBytesCompact, relativeTime } from "./lib/format"
import { pctColor } from "./views/SubListView"

const APP_NAME = "submon"

function Header({ updatedAt, compact }: { updatedAt: number; compact?: boolean }) {
  return (
    <HStack spacing={5}>
      <Image systemName="gauge.with.needle" font={compact ? 12 : 13} foregroundStyle="systemGreen" />
      <Text font={compact ? 11 : 13} fontWeight="bold" lineLimit={1} minScaleFactor={0.8}>{APP_NAME}</Text>
      <Spacer />
      <Text font={compact ? 9 : 10} foregroundStyle="secondary" monospacedDigit lineLimit={1}>
        {updatedAt > 0 ? relativeTime(updatedAt) : ""}
      </Text>
    </HStack>
  )
}

/** 用量百分比 → 语义色（与列表页一致） */
function pctColorLocal(pct: number): string {
  if (pct < 80) return "systemGreen"
  if (pct < 95) return "systemOrange"
  return "systemRed"
}

function daysText(info: { expire: number }): { text: string; color: string } {
  if (info.expire <= 0) return { text: "无限期", color: "secondary" }
  if (isExpired(info.expire)) return { text: "已过期", color: "systemRed" }
  const dl = daysLeft(info.expire)
  return { text: `剩 ${dl} 天`, color: dl <= 3 ? "systemOrange" : "secondary" }
}

/** 行组件（medium 用） */
function SubRow({ sub, state }: { sub: Sub; state?: SubState }) {
  const info = state?.info ?? null
  const used = info ? info.upload + info.download : 0
  const pct = info ? pctUsed(used, info.total) : 0
  const dl = info ? daysText(info) : { text: "未获取", color: "secondary" }
  return (
    <VStack spacing={2} alignment="leading">
      <HStack spacing={5}>
        <Text font={12} fontWeight="medium" lineLimit={1} minScaleFactor={0.8}>{sub.name}</Text>
        <Spacer />
        <Text font={11} monospacedDigit foregroundStyle={(info && info.total > 0 ? pctColorLocal(pct) : "secondary") as any}>
          {info && info.total > 0 ? `${pct}%` : (info && info.total === 0 ? "不限量" : "")}
        </Text>
        <Text font={10} monospacedDigit foregroundStyle={(dl.color) as any} lineLimit={1}>{dl.text}</Text>
      </HStack>
      <HStack spacing={6}>
        {info && info.total > 0 ? (
          <ProgressView value={used} total={info.total} tint={(pctColorLocal(pct)) as any} />
        ) : (
          <VStack frame={{ maxWidth: "infinity", height: 4 }} />
        )}
        <Text font={9} foregroundStyle="secondary" monospacedDigit lineLimit={1}>
          {info && info.total > 0 ? `${formatBytes(used)}/${formatBytes(info.total)}` : ""}
        </Text>
      </HStack>
    </VStack>
  )
}

/** small 单卡：显示排序后第一条（最近到期） */
function SmallCard({ sub, state }: { sub: Sub; state?: SubState }) {
  const info = state?.info ?? null
  const used = info ? info.upload + info.download : 0
  const pct = info ? pctUsed(used, info.total) : 0
  const dl = info ? daysText(info) : { text: "未获取", color: "secondary" }
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font={13} fontWeight="semibold" lineLimit={1} minScaleFactor={0.8}>{sub.name}</Text>
      <Spacer />
      <Text font={30} fontWeight="bold" monospacedDigit foregroundStyle={(info && info.total > 0 ? pctColorLocal(pct) : "secondary") as any}>
        {info && info.total > 0 ? `${pct}%` : (info && info.total === 0 ? "∞" : "—")}
      </Text>
      <ProgressView value={used} total={info.total > 0 ? info.total : 1} tint={(info && info.total > 0 ? pctColorLocal(pct) : "secondary") as any} />
      <Spacer />
      <HStack spacing={4}>
        <Text font={9} foregroundStyle="secondary" monospacedDigit lineLimit={1} minScaleFactor={0.8}>
          {info ? (info.total > 0 ? `${formatBytesCompact(used)}/${formatBytesCompact(info.total)}` : "不限量") : "下拉 App 刷新"}
        </Text>
        <Spacer />
        <Text font={9} monospacedDigit foregroundStyle={(dl.color) as any} lineLimit={1}>{dl.text}</Text>
      </HStack>
    </VStack>
  )
}

/** 核心渲染（subs/states/family 注入，便于 mock 预览） */
export function SubWidgetCore({ subs, states, family }: {
  subs: Sub[]
  states: Record<string, SubState>
  family: string | undefined
}) {
  const ordered = sortByExpiry(subs, (s) => states[s.url]?.info?.expire ?? 0)
  const latest = Math.max(0, ...Object.values(states).map((s) => s.updatedAt))
  const isSmall = family === "systemSmall"

  if (ordered.length === 0) {
    return (
      <VStack spacing={6} padding={{ top: 14, leading: 14, trailing: 14, bottom: 11 }}>
        <Header updatedAt={0} compact={isSmall} />
        <Spacer />
        <Text font={12} foregroundStyle="secondary">点击添加订阅</Text>
        <Spacer />
      </VStack>
    )
  }

  return (
    <VStack spacing={isSmall ? 4 : 7} alignment="leading" padding={{ top: 13, leading: 14, trailing: 14, bottom: 11 }}>
      <Header updatedAt={latest} compact={isSmall} />
      {isSmall ? (
        <SmallCard sub={ordered[0]} state={states[ordered[0].url]} />
      ) : (
        ordered.slice(0, 3).map((s) => (
          <SubRow key={s.url} sub={s} state={states[s.url]} />
        ))
      )}
      <Spacer />
    </VStack>
  )
}

function WidgetView() {
  const subs = loadSubs()
  const states = loadStates()
  const runURL = Script.createRunURLScheme(APP_NAME)
  return (
    <VStack widgetURL={runURL} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <SubWidgetCore subs={subs} states={states} family={Widget.family} />
    </VStack>
  )
}

async function run() {
  // 小组件时间线允许短暂联网：先刷新再渲染（失败/超时用缓存）
  try {
    await Promise.race([
      refreshAll(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("widget refresh timeout")), 5000)),
    ])
  } catch {}
  Widget.present(<WidgetView />)
}

run()

// ---------- preview_ui mock ----------
const MOCK_SUBS: Sub[] = [
  { url: "https://a.example.com/sub", name: "香港主力", addedAt: 1 },
  { url: "https://b.example.com/sub", name: "备用机场", addedAt: 2 },
  { url: "https://c.example.com/sub", name: "年付不限量", addedAt: 3 },
  { url: "https://d.example.com/sub", name: "第四条不显示", addedAt: 4 },
]
const NOW = Math.floor(Date.now() / 1000)
const MOCK_STATES: Record<string, SubState> = {
  "https://a.example.com/sub": {
    info: { upload: 8.6e9, download: 300e9, total: 1024e9, expire: NOW + 12 * 86400 },
    error: null, updatedAt: Date.now() - 5 * 60000, attemptedAt: Date.now() - 5 * 60000,
  },
  "https://b.example.com/sub": {
    info: { upload: 45e9, download: 870e9, total: 1000e9, expire: NOW + 1.5 * 86400 },
    error: "HTTP 403", updatedAt: Date.now() - 26 * 3600000, attemptedAt: Date.now() - 60000,
  },
  "https://c.example.com/sub": {
    info: { upload: 1e6, download: 2e6, total: 0, expire: 0 },
    error: null, updatedAt: Date.now() - 3000, attemptedAt: Date.now() - 3000,
  },
}

export default function WidgetPreview({ family = "systemMedium" }: { family?: string }) {
  const small = family === "systemSmall"
  return (
    <VStack
      frame={{ width: small ? 158 : 345, height: 158 }}
      background={{ style: { light: "#ffffff", dark: "#0d1117" }, shape: "rect" }}
    >
      <SubWidgetCore subs={MOCK_SUBS} states={MOCK_STATES} family={family} />
    </VStack>
  )
}