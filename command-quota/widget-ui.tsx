// widget-ui.tsx — 小组件纯组件（供 widget.tsx 与 preview-widget.tsx 复用）
import { VStack, HStack, Text, Image, Spacer, ProgressView } from 'scripting'
import { Win, fmtMoney, fmtTokens, remRGB, resetShort, countdown } from './core'

/* 小字颜色：浅色统一 #6C6C70，深色统一 #8A8A8F（均稍提高辨识度） */
const TXT_SUB: any = { light: "#6C6C70", dark: "#8A8A8F" }
const TXT_MUTED: any = { light: "#6C6C70", dark: "#8A8A8F" }
/* 徽标底色：与 ollama-quota 完全一致（深灰方底 + 白色 SF Symbol） */
const BADGE_BG = "rgba(28,30,35,1)"

export interface WState {
  name: string
  plan: string
  five: Win | null
  weekly: Win | null
  totalRemaining: number
  monthlyRemaining: number
  extraRemaining: number
  usagePct: number
  requests: number
  tokens: number
  totalSpent: number
  error: string
}

/* 标题：固定显示品牌名（与 ollama 组件一致，不再拼账号别名/套餐） */
function titleOf(_st: WState): string {
  return "Command"
}

/* 组件内部统一用「剩余量」术语；颜色换算在边界处做（remRGB 入参为已用百分比） */
function colorOf(rem: number): [string, string] {
  return remRGB(100 - rem)
}

/* 主窗口：优先周额度（更慢的窗口更能代表整体余量），没有则用 5 小时 */
function mainRem(st: WState): number | null {
  const w = st.weekly ?? st.five
  return w ? Math.max(0, 100 - w.pct) : null
}

function mainWin(st: WState): Win | null {
  return st.weekly ?? st.five
}

export function Badge({ size, icon }: { size: number; icon: string }) {
  return (
    <VStack frame={{ width: size, height: size, alignment: "center" }} background={{ style: BADGE_BG, shape: { type: "rect", cornerRadius: size * 0.3 } } as any}>
      <Image systemName={icon} frame={{ width: size * 0.55, height: size * 0.55 }} foregroundStyle="white" />
    </VStack>
  )
}

/* 弹性进度条:填充长度 = 剩余量,颜色按剩余严重度 */
export function Bar({ rem, h }: { rem: number; h?: number }) {
  const [c1] = colorOf(rem)
  return (
    <VStack frame={{ maxWidth: "infinity", height: h ?? 6, alignment: "center" }}>
      <ProgressView value={Math.max(0, Math.min(100, rem))} total={100} tint={c1 as any} />
    </VStack>
  )
}

export function Placeholder({ text, icon }: { text: string; icon: string }) {
  return (
    <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={16}>
      <Image systemName={icon} frame={{ width: 30, height: 30 }} foregroundStyle="systemOrange" />
      <Text font="footnote" foregroundStyle={TXT_SUB} frame={{ maxWidth: "infinity", alignment: "center" }}>{text}</Text>
    </VStack>
  )
}

function remainLine(w: Win | null): string {
  if (!w) return ""
  return `剩 ${Math.max(0, 100 - w.pct).toFixed(0)}%`
}

/* 单账号(小尺寸):周额度剩余大字 + 5小时/余额/请求量/倒计时 */
export function SmallSingle({ st }: { st: WState }) {
  const rem = mainRem(st)
  if (rem === null) return <Placeholder text={st.error || "暂无数据"} icon={st.error ? "exclamationmark.triangle" : "gauge"} />
  const [c1] = colorOf(rem)
  const w = mainWin(st)
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 9 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <Badge size={18} icon="gauge" />
        <Spacer />
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>{titleOf(st)}</Text>
      </HStack>
      <Spacer minLength={0} />
      <HStack alignment="firstTextBaseline" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}>
        <Text font={32} foregroundStyle={c1 as any} fontWeight="bold">{rem.toFixed(0)}</Text>
        <Text font={13} foregroundStyle={c1 as any} fontWeight="bold">%</Text>
      </HStack>
      <Text font="caption2" foregroundStyle={TXT_SUB}>{st.weekly ? "周额度 剩余" : "5小时 剩余"}</Text>
      <Spacer minLength={0} />
      <Bar rem={rem} h={5} />
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>
          {st.five ? `5小时 ${remainLine(st.five)}` : `${st.requests} 请求`}
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>{fmtMoney(st.totalRemaining)}</Text>
      </HStack>
      {w ? (
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1} minScaleFactor={0.8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {resetShort(w)}
        </Text>
      ) : null}
    </VStack>
  )
}

/* 多账号(小尺寸):左右分屏,各显该账号的周额度剩余 */
export function SmallDual({ states }: { states: WState[] }) {
  const list = states.slice(0, 2)
  const w0 = mainWin(list[0])
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 12, vertical: 11 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <Badge size={17} icon="gauge" />
        <Spacer minLength={4} />
        <Text font="caption2" foregroundStyle={TXT_MUTED} fontWeight="medium">{`Command × ${states.length}`}</Text>
      </HStack>
      <Spacer minLength={0} />
      <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {list.map((st, i) => {
          const rem = mainRem(st)
          const [c1] = colorOf(rem ?? 0)
          return (
            <HStack key={i} spacing={0} frame={{ maxWidth: "infinity", alignment: "center" }}>
              {i > 0 ? <VStack frame={{ width: 1, height: 44 }} background={"separator" as any} /> : null}
              <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ leading: i > 0 ? 7 : 0 }}>
                <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>{st.name}</Text>
                {rem !== null ? (
                  <HStack alignment="firstTextBaseline" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}>
                    <Text font={24} foregroundStyle={c1 as any} fontWeight="bold">{rem.toFixed(0)}</Text>
                    <Text font={11} foregroundStyle={c1 as any} fontWeight="bold">%</Text>
                  </HStack>
                ) : (
                  <Text font="caption2" foregroundStyle="systemRed">{st.error ? "失败" : "暂无"}</Text>
                )}
                <Bar rem={rem ?? 0} h={5} />
              </VStack>
            </HStack>
          )
        })}
      </HStack>
      <Spacer minLength={0} />
      <Text font="caption2" foregroundStyle={TXT_MUTED} frame={{ maxWidth: "infinity", alignment: "center" }} lineLimit={1} minScaleFactor={0.8}>
        {w0 && w0.resetAt ? `${countdown(Date.now(), w0.resetAt)} 后重置` : ""}
      </Text>
    </VStack>
  )
}

/* 窗口行:标签·明细 连着写（同 ollama）+ 剩余%；条下不放任何文字；compact 用于双账号窄列 */
function WinRow({ label, w, compact }: { label: string; w: Win | null; compact?: boolean }) {
  if (!w) return null
  const rem = Math.max(0, 100 - w.pct)
  const [c1] = colorOf(rem)
  const meta = compact
    ? `${fmtMoney(w.used)} / ${fmtMoney(w.cap)}`
    : `已用 ${fmtMoney(w.used)} / ${fmtMoney(w.cap)}`
  return (
    <VStack spacing={compact ? 3 : 4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline" spacing={6}>
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1} minScaleFactor={0.75}>{`${label} · ${meta}`}</Text>
        <Spacer />
        <HStack alignment="firstTextBaseline" spacing={2}>
          <Text font={compact ? 16 : 17} foregroundStyle={c1 as any} fontWeight="bold">{rem.toFixed(0)}</Text>
          <Text font={compact ? 10 : 11} foregroundStyle={c1 as any} fontWeight="bold">%</Text>
        </HStack>
      </HStack>
      <Bar rem={rem} h={compact ? 5 : 6} />
    </VStack>
  )
}

/* 账号列(多账号中/大尺寸) */
function AcctCol({ st, withDivider }: { st: WState; withDivider: boolean }) {
  const w = mainWin(st)
  return (
    <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      {withDivider ? <VStack frame={{ width: 1, maxHeight: "infinity" }} background={"separator" as any} /> : null}
      <VStack spacing={7} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }} padding={{ leading: withDivider ? 9 : 0 }}>
        <HStack frame={{ maxWidth: "infinity" }} alignment="center">
          <Text font="caption2" foregroundStyle="label" fontWeight="bold" lineLimit={1}>{st.name}</Text>
          {st.plan ? <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>{` ${st.plan}`}</Text> : null}
          <Spacer />
          <Text font="caption2" foregroundStyle={TXT_MUTED} monospacedDigit>{fmtMoney(st.totalRemaining)}</Text>
        </HStack>
        {st.error ? (
          <Text font="caption2" foregroundStyle="systemRed" lineLimit={2}>{st.error}</Text>
        ) : (
          <VStack spacing={7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <WinRow label="5 小时" w={st.five} compact />
            <WinRow label="周额度" w={st.weekly} compact />
          </VStack>
        )}
        {w ? <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1} minScaleFactor={0.8}>{resetShort(w)}</Text> : null}
      </VStack>
    </HStack>
  )
}

function nowHM(): string {
  const d = new Date()
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 统计行（大尺寸单账号展开） */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
      <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1}>{label}</Text>
      <Spacer />
      <Text font="caption2" foregroundStyle="label" fontWeight="medium" monospacedDigit>{value}</Text>
    </HStack>
  )
}

/* 单账号(中/大尺寸):全宽双窗口 + 底部统计行，expanded 时附本周期明细 */
export function SingleW({ st, expanded }: { st: WState; expanded?: boolean }) {
  const w = mainWin(st)
  const foot: string[] = []
  if (w) foot.push(resetShort(w))
  foot.push(`更新 ${nowHM()}`)
  // ollama 在 footer 上方有一行模型明细小字；Command 无模型维度，同位置换成同周期用量汇总
  const usageLine = expanded ? "" : `本周期 ${st.requests} 次 · ${fmtTokens(st.tokens)} tokens · ${fmtMoney(st.totalSpent)}`
  return (
    <VStack spacing={9} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 10 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <HStack spacing={5} alignment="center">
          <Badge size={18} icon="gauge" />
          <Text font={11} foregroundStyle="label" fontWeight="bold" lineLimit={1}>{titleOf(st)}</Text>
        </HStack>
        <Spacer />
        <Text font="caption2" foregroundStyle={TXT_MUTED} monospacedDigit>{`余额 ${fmtMoney(st.totalRemaining)}`}</Text>
      </HStack>
      {st.error ? (
        <Text font="caption2" foregroundStyle="systemRed" lineLimit={2}>{st.error}</Text>
      ) : (
        <VStack spacing={9} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <WinRow label="5 小时" w={st.five} />
          <WinRow label="周额度" w={st.weekly} />
        </VStack>
      )}
      {expanded ? (
        <VStack spacing={7} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <StatRow label="订阅月额度剩余" value={fmtMoney(st.monthlyRemaining)} />
          <StatRow label="额外额度剩余" value={fmtMoney(st.extraRemaining)} />
          <StatRow label="本周期花费" value={fmtMoney(st.totalSpent)} />
          <StatRow label="本周期请求" value={`${st.requests} 次`} />
          <StatRow label="本周期 Token" value={fmtTokens(st.tokens)} />
        </VStack>
      ) : null}
      <Spacer minLength={0} />
      <VStack spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {usageLine ? (
          <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1} minScaleFactor={0.8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            {usageLine}
          </Text>
        ) : null}
        <Text font="caption2" foregroundStyle={TXT_MUTED} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {foot.join(" · ")}
        </Text>
      </VStack>
    </VStack>
  )
}

/* 多账号(中/大尺寸):双列；单账号时走 SingleW 全宽布局 */
export function MultiW({ states, expanded }: { states: WState[]; expanded?: boolean }) {
  const list = states.slice(0, 2)
  if (list.length === 1) return <SingleW st={list[0]} expanded={expanded} />
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 11 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <HStack spacing={5} alignment="center">
          <Badge size={18} icon="gauge" />
          <Text font={11} foregroundStyle="label" fontWeight="bold">Command 额度</Text>
        </HStack>
        <Spacer />
        <Text font="caption2" foregroundStyle={TXT_MUTED}>{`${list.length} 账号`}</Text>
      </HStack>
      <Spacer minLength={8} />
      <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {list.map((st, i) => <AcctCol key={i} st={st} withDivider={i > 0} />)}
      </HStack>
      <Spacer minLength={8} />
    </VStack>
  )
}
