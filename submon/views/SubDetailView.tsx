// views/SubDetailView.tsx — 订阅详情：流量明细 / 到期 / 刷新状态 / 刷新此订阅 / 编辑 / 删除
// DetailCore 注入数据便于 preview mock；SubDetailView 负责按 url 装载与交互

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer,
  ProgressView, useState, Navigation,
} from "scripting"
import { loadSubs, removeSub } from "../lib/subs"
import type { Sub } from "../lib/subs"
import { loadStates, saveStates, refreshAll } from "../lib/store"
import type { SubState } from "../lib/store"
import {
  pctUsed, formatBytes, formatExpireDate, relativeTime,
} from "../lib/format"
import { pctColor, daysMeta } from "./SubListView"
import { emitDataChanged } from "../lib/bus"
import { SubEditSheet } from "./SubEditSheet"

function Row({ icon, label, value, color }: {
  icon: string
  label: string
  value: string
  color?: string
}) {
  return (
    <HStack spacing={10}>
      <Image systemName={icon} foregroundStyle="systemGreen" frame={{ width: 26 }} font={14} />
      <Text font={15} foregroundStyle="label">{label}</Text>
      <Spacer />
      <Text font={14} monospacedDigit foregroundStyle={(color ?? "secondaryLabel") as any}>{value}</Text>
    </HStack>
  )
}

/** 详情核心渲染（数据与回调注入，便于 mock 预览） */
export function DetailCore({ sub, state, busy, confirmDelete, copied, showEdit, onCloseEdit, onRefresh, onDelete, onEdit, onCopy }: {
  sub: Sub
  state?: SubState
  busy: boolean
  confirmDelete: boolean
  copied: boolean
  showEdit: boolean
  onCloseEdit: () => void
  onRefresh: () => void
  onDelete: () => void
  onEdit: () => void
  onCopy: () => void
}) {
  const info = state?.info ?? null
  const used = info ? info.upload + info.download : 0
  const pct = info ? pctUsed(used, info.total) : 0
  const dl = daysMeta(info)

  return (
    <List
      navigationTitle={sub.name}
      navigationBarTitleDisplayMode="inline"
      sheet={showEdit ? {
        isPresented: true,
        onChanged: (v: boolean) => { if (!v) onCloseEdit() },
        content: (
          <SubEditSheet
            sub={sub}
            onClose={onCloseEdit}
          />
        ),
      } : {
        isPresented: false,
        onChanged: () => {},
        content: <VStack />,
      }}
    >
      <Section title="流量">
        {info && info.total > 0 ? (
          <VStack spacing={8} padding={{ vertical: 4 }}>
            <HStack>
              <Text font={28} fontWeight="bold" monospacedDigit foregroundStyle={(pctColor(pct)) as any}>{pct}%</Text>
              <Spacer />
              <Text font={12} foregroundStyle="tertiaryLabel">已用 / 总量</Text>
            </HStack>
            <ProgressView value={used} total={info.total} tint={(pctColor(pct)) as any} />
          </VStack>
        ) : null}
        <Row icon="arrow.up" label="上传" value={info ? formatBytes(info.upload) : "—"} />
        <Row icon="arrow.down" label="下载" value={info ? formatBytes(info.download) : "—"} />
        <Row icon="arrow.up.arrow.down" label="已用合计" value={info ? formatBytes(used) : "—"} color={info ? "label" : undefined} />
        <Row
          icon="server.rack"
          label="总量"
          value={info ? (info.total > 0 ? formatBytes(info.total) : "不限量") : "—"}
        />
        {!info ? (
          <Text font={12} foregroundStyle="tertiaryLabel">尚未获取到流量数据，点下方「刷新此订阅」。</Text>
        ) : null}
      </Section>

      <Section title="到期">
        <Row icon="calendar" label="到期日期" value={info ? formatExpireDate(info.expire) : "—"} />
        <Row
          icon="hourglass"
          label="剩余天数"
          value={info ? (dl.text || "—") : "—"}
          color={info ? dl.color : undefined}
        />
      </Section>

      <Section title="状态">
        <Row icon="clock" label="上次成功刷新" value={state && state.updatedAt > 0 ? relativeTime(state.updatedAt) : "—"} />
        <Row icon="clock.arrow.circlepath" label="上次尝试" value={state && state.attemptedAt > 0 ? relativeTime(state.attemptedAt) : "—"} />
        {state?.error ? (
          <VStack alignment="leading" spacing={2} padding={{ vertical: 2 }}>
            <Text font={12} foregroundStyle="systemRed">上次刷新失败：{state.error}</Text>
          </VStack>
        ) : null}
        {state && !state.error && state.info ? (
          <Text font={12} foregroundStyle="tertiaryLabel">最近一次刷新成功。</Text>
        ) : null}
      </Section>

      <Section title="链接">
        <VStack alignment="leading" spacing={6} padding={{ vertical: 2 }}>
          <Text font={12} foregroundStyle="secondaryLabel" lineLimit={3}>{sub.url}</Text>
          <Button action={onCopy}>
            <Text font={13} foregroundStyle="systemGreen">{copied ? "已复制 ✓" : "复制链接"}</Text>
          </Button>
        </VStack>
        {sub.ua ? <Row icon="terminal" label="自定义 UA" value={sub.ua} /> : null}
      </Section>

      <Section footer={<Text font={11} foregroundStyle="tertiaryLabel">iOS 桌面小组件由系统定期刷新，这里可手动获取最新数据。</Text>}>
        <Button action={onRefresh}>
          <HStack spacing={10}>
            <Image
              systemName={busy ? "hourglass" : "arrow.clockwise"}
              foregroundStyle="systemGreen"
              frame={{ width: 26 }}
              font={14}
            />
            <Text font={15} foregroundStyle="systemGreen">{busy ? "刷新中…" : "刷新此订阅"}</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button action={onEdit}>
          <HStack spacing={10}>
            <Image systemName="pencil" foregroundStyle="systemBlue" frame={{ width: 26 }} font={14} />
            <Text font={15} foregroundStyle="systemBlue">编辑订阅</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button action={onDelete}>
          <HStack spacing={10}>
            <Image systemName="trash" foregroundStyle="systemRed" frame={{ width: 26 }} font={14} />
            <Text font={15} foregroundStyle="systemRed">
              {confirmDelete ? "再点一次确认删除" : "删除订阅"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>
    </List>
  )
}

/** 实际详情页：按 url 装载数据与交互 */
export function SubDetailView({ url }: { url: string }) {
  const dismiss = Navigation.useDismiss()
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [copied, setCopied] = useState(false)

  // version 触发重读盘（本页数据量小，不必走 bus 订阅）
  const s = loadSubs().find((x) => x.url === url)
  const st = loadStates()[url]

  async function refreshThis() {
    if (busy) return
    setBusy(true)
    try {
      await refreshAll(undefined, loadSubs().filter((x) => x.url === url))
    } catch {}
    setVersion((v) => v + 1)
    emitDataChanged()
    setBusy(false)
  }

  async function copyLink() {
    if (!s) return
    await Pasteboard.setString(s.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function doDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    removeSub(url)
    const states = loadStates()
    if (states[url]) {
      const next = { ...states }
      delete next[url]
      saveStates(next)
    }
    emitDataChanged()
    dismiss()
  }

  if (!s) {
    return (
      <List navigationTitle="订阅详情" navigationBarTitleDisplayMode="inline">
        <Text font={14} foregroundStyle="secondaryLabel">该订阅已被删除</Text>
      </List>
    )
  }

  return (
    <DetailCore
      sub={s}
      state={st}
      busy={busy}
      confirmDelete={confirmDelete}
      copied={copied}
      showEdit={showEdit}
      onCloseEdit={() => {
        setShowEdit(false)
        setVersion((v) => v + 1)
      }}
      onRefresh={refreshThis}
      onDelete={doDelete}
      onEdit={() => setShowEdit(true)}
      onCopy={copyLink}
    />
  )
}

// ---------- preview_ui mock ----------
const MOCK_SUB: Sub = { url: "https://a.example.com/sub?token=abc123", name: "香港主力", ua: "clash", addedAt: 1 }
const MOCK_STATE: SubState = {
  info: { upload: 8.6e9, download: 300e9, total: 1024e9, expire: Math.floor(Date.now() / 1000) + 12 * 86400 },
  error: "HTTP 403",
  updatedAt: Date.now() - 5 * 60000,
  attemptedAt: Date.now() - 60000,
}

export default function SubDetailViewPreview() {
  return (
    <VStack
      spacing={0}
      frame={{ width: 390, height: 844 }}
      background={{ style: { light: "#f2f2f7", dark: "#0d1117" }, shape: "rect" }}
    >
      <DetailCore
        sub={MOCK_SUB}
        state={MOCK_STATE}
        busy={false}
        confirmDelete={false}
        copied={false}
        showEdit={false}
        onCloseEdit={() => {}}
        onRefresh={() => {}}
        onDelete={() => {}}
        onEdit={() => {}}
        onCopy={() => {}}
      />
    </VStack>
  )
}