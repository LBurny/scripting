// views/SubListView.tsx — 订阅列表（按到期时间排序），点行进详情，sheet 添加/编辑入口

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, NavigationLink,
  ProgressView, useState, useEffect, Group, ZStack, RoundedRectangle, Widget,
} from "scripting"
import { loadSubs, removeSub } from "../lib/subs"
import type { Sub } from "../lib/subs"
import { loadStates, saveStates } from "../lib/store"
import type { SubState } from "../lib/store"
import { sortByExpiry, pctUsed, daysLeft, isExpired, formatBytes } from "../lib/format"
import { emitDataChanged, onDataChanged } from "../lib/bus"
import { SubEditSheet } from "./SubEditSheet"
import { SubDetailView } from "./SubDetailView"

const ICON_W = 26

/** 用量百分比 → 语义色：<80 绿 / <95 橙 / 其余红 */
export function pctColor(pct: number): string {
  if (pct < 80) return "systemGreen"
  if (pct < 95) return "systemOrange"
  return "systemRed"
}

/** 剩余天数文案与颜色（state.info 缺失时显示空） */
export function daysMeta(info: { expire: number } | null | undefined): { text: string; color: string } {
  if (!info || info.expire <= 0) return { text: info ? "无限期" : "", color: "secondaryLabel" }
  if (isExpired(info.expire)) return { text: "已过期", color: "systemRed" }
  const dl = daysLeft(info.expire)
  if (dl <= 3) return { text: `剩 ${dl} 天`, color: "systemOrange" }
  return { text: `剩 ${dl} 天`, color: "secondaryLabel" }
}

/** List.sheet 透传类型（收起时也须给完整对象，不能 undefined） */
type ListSheetSpec = {
  isPresented: boolean
  onChanged: (v: boolean) => void
  content: any
}

/** 列表核心渲染（subs/states/sheet/message/onEdit/onDelete 注入，全页仅此一个 List） */
export function SubListCore({ subs, states, onAdd, sheet, message, onEdit, onDelete }: {
  subs: Sub[]
  states: Record<string, SubState>
  onAdd: () => void
  sheet?: any
  message?: string
  onEdit?: (s: Sub) => void
  onDelete?: (s: Sub) => void
}) {
  const ordered = sortByExpiry(subs, (s) => states[s.url]?.info?.expire ?? 0)
  return (
    <List
      navigationTitle="订阅"
      navigationBarTitleDisplayMode="inline"
      sheet={sheet ?? { isPresented: false, onChanged: () => {}, content: <VStack /> }}
    >
      <Section>
        <Button action={onAdd}>
          <HStack spacing={10}>
            <Image systemName="plus.circle.fill" foregroundStyle="systemGreen" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="systemGreen">添加订阅</Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>
      <Section
        title={`订阅 ${subs.length} 个`}
        footer={<Text font={11} foregroundStyle="tertiaryLabel">按到期时间排序；点按查看流量明细，进入详情可编辑或删除。</Text>}
      >
        {ordered.length === 0 ? (
          <VStack alignment="leading" spacing={4} padding={{ vertical: 8 }}>
            <Text font={13} foregroundStyle="secondaryLabel">还没有订阅，点上方「添加订阅」开始。</Text>
          </VStack>
        ) : ordered.map((s) => {
          const st = states[s.url]
          const info = st?.info ?? null
          const used = info ? info.upload + info.download : 0
          const pct = info ? pctUsed(used, info.total) : 0
          const dl = daysMeta(info)
          const menuItems = (
            <Group>
              <Button title="编辑" action={() => onEdit && onEdit(s)} />
              <Button title="删除" role="destructive" action={() => onDelete && onDelete(s)} />
            </Group>
          )
          return (
            <NavigationLink
              key={s.url}
              destination={<SubDetailView url={s.url} />}
              contextMenu={{ menuItems }}
            >
              <VStack alignment="leading" spacing={6}>
                <HStack spacing={8}>
                  <Image systemName="gauge.with.needle" foregroundStyle="systemGreen" frame={{ width: ICON_W }} />
                  <Text font={15} fontWeight="medium" lineLimit={1}>{s.name}</Text>
                  <Spacer />
                  <Text font={12} monospacedDigit foregroundStyle={(info ? pctColor(pct) : "tertiaryLabel") as any}>
                    {info && info.total > 0 ? `${pct}%` : (info && info.total === 0 ? "不限量" : "未获取")}
                  </Text>
                </HStack>
                {info && info.total > 0 ? (
                  <ProgressView value={used} total={info.total} tint={(pctColor(pct)) as any} />
                ) : null}
                <HStack spacing={6} padding={{ leading: ICON_W }}>
                  <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
                    {info
                      ? (info.total > 0 ? `${formatBytes(used)} / ${formatBytes(info.total)}` : "—")
                      : "尚未刷新，点右上角刷新"}
                  </Text>
                  {st?.error ? (
                    <Text font={11} foregroundStyle="systemRed" lineLimit={1}>刷新失败</Text>
                  ) : null}
                  <Spacer />
                  <Text font={11} monospacedDigit foregroundStyle={(dl.color) as any}>{dl.text}</Text>
                </HStack>
              </VStack>
            </NavigationLink>
          )
        })}
      </Section>
      {message ? (
        <Section>
          <Text font={12} foregroundStyle="secondaryLabel">{message}</Text>
        </Section>
      ) : null}
    </List>
  )
}

/** 仿系统 alert 的删除确认浮层（自绘：遮罩 + 居中卡片；alert 的 action 真机不触发，故不用系统 alert） */
export function ConfirmOverlay({ sub, onConfirm, onCancel }: {
  sub: Sub
  onConfirm: () => void
  onCancel: () => void
}) {
  const separator: any = { style: { light: "rgba(60,60,67,0.29)", dark: "rgba(84,84,88,0.65)" }, shape: "rect" }
  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 遮罩：点按取消（用 onTapGesture 而非整屏 Button，避免遮挡层吞掉卡片按钮的点击） */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={{ style: { light: "rgba(0,0,0,0.3)", dark: "rgba(0,0,0,0.5)" }, shape: "rect" }}
        onTapGesture={onCancel}
      />
      {/* 居中卡片（270pt，圆角 14 + 投影，仿 iOS alert）：RoundedRectangle 垫底 + 内容覆盖 */}
      <ZStack alignment="center" shadow={{ color: "rgba(0,0,0,0.25)", radius: 24, y: 10 }}>
        <RoundedRectangle cornerRadius={14} fill={{ light: "rgba(255,255,255,0.98)", dark: "#2C2C2E" }} frame={{ width: 270, height: 168 }} />
        <VStack spacing={0} frame={{ width: 270 }}>
          <VStack spacing={5} padding={{ top: 19, leading: 16, bottom: 17, trailing: 16 }} frame={{ maxWidth: "infinity" }}>
            <Text font={17} fontWeight="semibold" multilineTextAlignment="center" frame={{ maxWidth: "infinity" }}>删除订阅</Text>
            <Text font={13} foregroundStyle="secondaryLabel" multilineTextAlignment="center" lineLimit={3} frame={{ maxWidth: "infinity" }}>
              确定删除「{sub.name}」？流量快照会一并清除，小组件同步更新。
            </Text>
          </VStack>
          <HStack spacing={0} frame={{ maxWidth: "infinity", height: 0.5 }} background={separator} />
          <HStack spacing={0} frame={{ maxWidth: "infinity", height: 44 }}>
            <Button action={onCancel} buttonStyle="plain">
              <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                <Text font={17} fontWeight="semibold" foregroundStyle="systemGreen">取消</Text>
              </VStack>
            </Button>
            <VStack frame={{ width: 0.5, height: 44 }} background={separator} />
            <Button action={onConfirm} buttonStyle="plain">
              <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                <Text font={17} foregroundStyle="systemRed">删除</Text>
              </VStack>
            </Button>
          </HStack>
        </VStack>
      </ZStack>
    </ZStack>
  )
}

/** 实际列表页：加载数据，把 sheet/message/长按菜单回调透传给 SubListCore（不可再包 List——嵌套 List 会渲染塌陷） */
export function SubListView() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [states, setStates] = useState<Record<string, SubState>>({})
  /** null=不弹；"add"=添加；Sub=编辑该订阅 */
  const [sheetSub, setSheetSub] = useState<Sub | "add" | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Sub | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const reload = () => {
      setSubs(loadSubs())
      setStates(loadStates())
    }
    reload()
    return onDataChanged(reload)
  }, [])

  function doDeleteConfirmed() {
    const s = pendingDelete
    if (!s) return
    setPendingDelete(null)
    removeSub(s.url)
    // 同步清流量快照，避免小组件仍显示已删订阅
    const next = { ...loadStates() }
    delete next[s.url]
    saveStates(next)
    emitDataChanged()
    try { Widget.reloadAll() } catch {}
    setMessage(`已删除「${s.name}」`)
  }

  const editingSub = sheetSub && sheetSub !== "add" ? sheetSub : undefined

  return (
    <ZStack alignment="center">
      <SubListCore
        subs={subs}
        states={states}
        onAdd={() => setSheetSub("add")}
        onEdit={(s) => setSheetSub(s)}
        onDelete={(s) => setPendingDelete(s)}
        message={message}
        sheet={sheetSub ? {
          isPresented: true,
          onChanged: (v: boolean) => { if (!v) setSheetSub(null) },
          content: (
            <SubEditSheet
              sub={editingSub}
              onClose={(msg) => {
                setSheetSub(null)
                if (msg) setMessage(msg)
              }}
            />
          ),
        } : {
          isPresented: false,
          onChanged: () => {},
          content: <VStack />,
        }}
      />
      {pendingDelete ? (
        <ConfirmOverlay
          sub={pendingDelete}
          onConfirm={doDeleteConfirmed}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </ZStack>
  )
}

// ---------- preview_ui mock（scripting-ts preview_ui 本文件用） ----------
const MOCK_SUBS: Sub[] = [
  { url: "https://a.example.com/sub", name: "香港主力", addedAt: 1 },
  { url: "https://b.example.com/sub", name: "备用机场", addedAt: 2 },
  { url: "https://c.example.com/sub", name: "年付不限量", addedAt: 3 },
]
const MOCK_STATES: Record<string, SubState> = {
  "https://a.example.com/sub": {
    info: { upload: 8.6e9, download: 300e9, total: 1024e9, expire: Math.floor(Date.now() / 1000) + 12 * 86400 },
    error: null, updatedAt: Date.now() - 5 * 60000, attemptedAt: Date.now() - 5 * 60000,
  },
  "https://b.example.com/sub": {
    info: { upload: 45e9, download: 870e9, total: 1000e9, expire: Math.floor(Date.now() / 1000) + 1.5 * 86400 },
    error: "HTTP 403", updatedAt: Date.now() - 26 * 3600000, attemptedAt: Date.now() - 60000,
  },
  "https://c.example.com/sub": {
    info: { upload: 1e6, download: 2e6, total: 0, expire: 0 },
    error: null, updatedAt: Date.now() - 3000, attemptedAt: Date.now() - 3000,
  },
}

export default function SubListViewPreview() {
  return (
    <VStack
      spacing={0}
      frame={{ width: 390, height: 700 }}
      background={{ style: { light: "#f2f2f7", dark: "#0d1117" }, shape: "rect" }}
    >
      <SubListCore subs={MOCK_SUBS} states={MOCK_STATES} onAdd={() => {}} />
    </VStack>
  )
}