// views/ConvertPreviewSheet.tsx — 订阅预览 sheet：策略组 + 处理后节点（数据来自 lib/preview.ts 的 surge 解析）
// Core 注入式渲染（phase/result/error/回调全注入），default export 为 mock 预览
// 排版要点：组标题行/成员行全部平铺为 Section 的直接行（与 ConvertView 历史区同构），
// 多行合并为一张卡片 + 原生行分隔；若用 VStack 包裹每行会被渲染成独立小卡片（间距大、不统一）

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, ProgressView, useState,
} from "scripting"
import type { PreviewResult, PreviewGroup } from "../lib/preview"

const ICON_W = 26

/** 组类型中文名 + 图标（未知类型回退原值） */
const GROUP_TYPE_META: Record<string, { label: string; icon: string }> = {
  "select": { label: "手动选择", icon: "hand.tap" },
  "url-test": { label: "自动测速", icon: "bolt" },
  "fallback": { label: "故障转移", icon: "arrow.triangle.2.circlepath" },
  "load-balance": { label: "负载均衡", icon: "scalemass" },
  "relay": { label: "链式代理", icon: "link" },
}

function groupTypeMeta(t: string) {
  return GROUP_TYPE_META[t] ?? { label: t, icon: "person.2" }
}

/** 组标题行（点击展开/收起成员） */
function GroupHeaderRow({ icon, title, subtitle, expanded, onToggle }: {
  icon: string
  title: string
  subtitle: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <Button action={onToggle}>
      <HStack spacing={10}>
        <Image systemName={icon} foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
        <VStack alignment="leading" spacing={2}>
          <Text font={15} foregroundStyle="label" lineLimit={1}>{title}</Text>
          <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>{subtitle}</Text>
        </VStack>
        <Spacer />
        <Image systemName={expanded ? "chevron.up" : "chevron.down"} foregroundStyle="tertiaryLabel" font={11} />
      </HStack>
    </Button>
  )
}

/** 成员名行（缩进对齐标题文本，全宽左对齐） */
function MemberRow({ name }: { name: string }) {
  return (
    <HStack spacing={0} padding={{ leading: ICON_W + 10 }}>
      <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>{name}</Text>
      <Spacer />
    </HStack>
  )
}

/** 把「组标题行 + 展开时的成员行」平铺进行数组（keyPrefix 保证 key 唯一） */
function appendGroupRows(rows: any[], opts: {
  keyPrefix: string
  icon: string
  title: string
  subtitle: string
  members: string[]
  expanded: boolean
  onToggle: () => void
}) {
  rows.push(
    <GroupHeaderRow
      key={opts.keyPrefix + "_h"}
      icon={opts.icon}
      title={opts.title}
      subtitle={opts.subtitle}
      expanded={opts.expanded}
      onToggle={opts.onToggle}
    />,
  )
  if (opts.expanded) {
    opts.members.forEach((m, i) => {
      rows.push(<MemberRow key={opts.keyPrefix + "_m" + i} name={m} />)
    })
  }
}

/** 预览 sheet 核心（三态注入） */
export function PreviewSheetCore({ phase, result, error, notice, onRetry, onClose, initialExpanded }: {
  phase: "loading" | "error" | "done"
  result: PreviewResult | null
  error: string
  /** 非空时在摘要下方展示（如「已自动切换后端」） */
  notice: string
  onRetry: () => void
  onClose: () => void
  /** 预览调试用：初始展开的组名 */
  initialExpanded?: string[]
}) {
  const [expanded, setExpanded] = useState<string[]>(initialExpanded ?? [])
  const toggle = (key: string) =>
    setExpanded((arr) => (arr.indexOf(key) >= 0 ? arr.filter((k) => k !== key) : [...arr, key]))
  const done = phase === "done" && result !== null

  // 策略组 + 全部节点平铺为同一 Section 的行（紧凑单卡片 + 原生分隔线）
  const groupRows: any[] = []
  if (done && result) {
    result.groups.forEach((g: PreviewGroup) => {
      const meta = groupTypeMeta(g.type)
      appendGroupRows(groupRows, {
        keyPrefix: "g_" + g.name,
        icon: meta.icon,
        title: g.name,
        subtitle: `${meta.label} · ${g.members.length} 个成员`,
        members: g.members,
        expanded: expanded.indexOf(g.name) >= 0,
        onToggle: () => toggle(g.name),
      })
    })
    appendGroupRows(groupRows, {
      keyPrefix: "g___all__",
      icon: "list.bullet",
      title: "全部节点",
      subtitle: `${result.proxies.length} 个（处理后）`,
      members: result.proxies,
      expanded: expanded.indexOf("__all__") >= 0,
      onToggle: () => toggle("__all__"),
    })
  }

  return (
    <VStack spacing={0}>
      <HStack padding={{ top: 16, leading: 16, bottom: 4, trailing: 16 }}>
        <Button title="完成" action={onClose} />
        <Spacer />
        <Text font={16} fontWeight="semibold">订阅预览</Text>
        <Spacer />
        {phase === "error" ? (
          <Button title="重试" action={onRetry} />
        ) : (
          <Text font={15} foregroundStyle="clear">完成</Text>
        )}
      </HStack>
      <List>
        {phase === "loading" ? (
          <Section>
            <HStack spacing={10} padding={{ vertical: 8 }}>
              <ProgressView />
              <Text font={14} foregroundStyle="secondaryLabel">正在请求后端转换，请稍候…</Text>
            </HStack>
          </Section>
        ) : null}
        {phase === "error" ? (
          <Section footer={<Text font={11} foregroundStyle="tertiaryLabel">检查后端是否在线、订阅链接是否有效后点右上角「重试」。</Text>}>
            <HStack spacing={10}>
              <Image systemName="exclamationmark.triangle" foregroundStyle="systemRed" frame={{ width: ICON_W }} font={14} />
              <Text font={13} foregroundStyle="systemRed">{error}</Text>
            </HStack>
          </Section>
        ) : null}
        {done && result ? (
          <Section footer={<Text font={11} foregroundStyle="tertiaryLabel">预览以后端 surge 格式解析，分组与节点即为最终配置内容。</Text>}>
            {notice ? (
              <HStack spacing={10}>
                <Image systemName="arrow.triangle.2.circlepath" foregroundStyle="systemOrange" frame={{ width: ICON_W }} font={14} />
                <Text font={12} foregroundStyle="systemOrange">{notice}</Text>
              </HStack>
            ) : null}
            <HStack spacing={10}>
              <Image systemName="checkmark.circle" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
              <Text font={14} foregroundStyle="label">解析成功：{result.proxies.length} 个节点 · {result.groups.length} 个策略组</Text>
            </HStack>
          </Section>
        ) : null}
        {done && result ? (
          <Section title="策略组">
            {groupRows}
          </Section>
        ) : null}
      </List>
    </VStack>
  )
}

// ---------- preview_ui mock（scripting-ts preview_ui 本文件用） ----------
export default function ConvertPreviewSheetPreview() {
  const MOCK: PreviewResult = {
    proxies: ["🇭🇰 香港 01", "🇭🇰 香港 02", "🇯🇵 日本 01", "🇺🇸 美国 01"],
    groups: [
      { name: "🚀 节点选择", type: "select", members: ["♻️ 自动选择", "🇭🇰 香港 01", "🇭🇰 香港 02", "🇯🇵 日本 01", "🇺🇸 美国 01", "DIRECT"] },
      { name: "♻️ 自动选择", type: "url-test", members: ["🇭🇰 香港 01", "🇭🇰 香港 02", "🇯🇵 日本 01", "🇺🇸 美国 01"] },
      { name: "🌍 国外媒体", type: "select", members: ["🚀 节点选择", "🇭🇰 香港 01", "DIRECT"] },
    ],
  }
  return (
    <VStack
      spacing={0}
      frame={{ width: 390, height: 780 }}
      background={{ style: { light: "#f2f2f7", dark: "#0d1117" }, shape: "rect" }}
    >
      <PreviewSheetCore
        phase="done"
        result={MOCK}
        error=""
        notice="所选后端不可用，已自动切换到 api.dler.io"
        onRetry={() => { }}
        onClose={() => { }}
        initialExpanded={["♻️ 自动选择"]}
      />
    </VStack>
  )
}
