import { VStack, HStack, ZStack, Text, Widget, Spacer, Image, ProgressView, fetch } from 'scripting'

const BASE = "https://api.kimi.com/coding/v1"
const KEY_LIST = "kimi_code_keys"
const KEY_LEGACY = "kimi_code_api_key"

interface Account { key: string; name: string }
interface Row { label: string; used: number; limit: number; pct: number; resetAt: string; countdown: string }
interface AcctState { acc: Account; rows: Row[]; error: string }

function num(v: any): number | null {
  const n = parseInt(v)
  return isNaN(n) ? null : n
}

function loadAccounts(): Account[] {
  const raw = Storage.get<string>(KEY_LIST)
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const list = arr.filter((a: any) => a && typeof a.key === "string" && a.key).map((a: any, i: number) => ({ key: String(a.key), name: String(a.name || `Key ${i + 1}`) }))
        if (list.length) return list
      }
    } catch {}
  }
  const legacy = (Storage.get<string>(KEY_LEGACY) || "").trim()
  return legacy ? [{ key: legacy, name: "Key 1" }] : []
}

function resetInfo(d: any): { at: string; cd: string } {
  const raw = d.resetTime ?? d.reset_at ?? d.reset_time
  let ts: number | null = null
  if (typeof raw === "number" && isFinite(raw)) ts = raw < 1e12 ? raw * 1000 : raw
  else if (typeof raw === "string" && raw) {
    const t = Date.parse(raw.replace(" ", "T"))
    if (!isNaN(t)) ts = t
  }
  if (ts === null) {
    const rin = num(d.reset_in)
    if (rin !== null && rin > 0) ts = Date.now() + rin * 1000
  }
  if (ts !== null) {
    const diff = ts - Date.now()
    if (diff <= 0) return { at: "", cd: "已重置" }
    const days = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return { at: "", cd: `${days}天${h}时${m}分` }
    if (h > 0) return { at: "", cd: `${h}时${m}分` }
    return { at: "", cd: `${m}分` }
  }
  return { at: "", cd: "" }
}

function toRow(d: any, fallback: string): Row | null {
  if (!d || typeof d !== "object") return null
  const limit = num(d.limit ?? d.limit_amount) ?? 0
  let used = num(d.used ?? d.used_amount)
  if (used === null) {
    const rem = num(d.remaining)
    if (rem !== null && limit > 0) used = limit - rem
  }
  if (used === null && limit === 0) return null
  const ri = resetInfo(d)
  const u = used ?? 0
  const pct = limit > 0 ? Math.max(0, Math.min(100, u * 100 / limit)) : 0
  return { label: String(d.name || d.title || d.model_name || fallback), used: u, limit, pct, resetAt: ri.at, countdown: ri.cd }
}

function windowLabel(w: any, i: number): string {
  const dur = num(w?.duration)
  const unit = String(w?.timeUnit || w?.time_unit || "").toUpperCase()
  if (dur !== null) {
    if (unit.includes("MINUTE")) return dur >= 60 && dur % 60 === 0 ? `${dur / 60}小时限额` : `${dur}分钟限额`
    if (unit.includes("HOUR")) return `${dur}小时限额`
    if (unit.includes("DAY")) return `${dur}天限额`
    if (unit.includes("MONTH")) return `${dur}月限额`
    return `限额 ${i + 1}`
  }
  return `限额 ${i + 1}`
}

function parseRows(payload: any): Row[] {
  const rows: Row[] = []
  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      const r = toRow(item, item?.model_name === "all" ? "周用量" : "限额")
      if (r) rows.push(r)
    }
  } else {
    if (payload?.usage && typeof payload.usage === "object") {
      const r = toRow(payload.usage, "周用量")
      if (r) rows.push(r)
    }
    if (Array.isArray(payload?.limits)) {
      payload.limits.forEach((item: any, i: number) => {
        const detail = item?.detail && typeof item.detail === "object" ? item.detail : item
        const w = item?.window && typeof item.window === "object" ? item.window : {}
        const r = toRow(detail, windowLabel(w, i))
        if (r) rows.push(r)
      })
    }
  }
  return rows
}

function remRGB(remPct: number): [string, string] {
  if (remPct >= 50) return ["rgba(48,209,88,1)", "rgba(48,209,88,0.45)"]
  if (remPct >= 30) return ["rgba(255,214,10,1)", "rgba(255,214,10,0.45)"]
  if (remPct >= 15) return ["rgba(255,159,10,1)", "rgba(255,159,10,0.45)"]
  return ["rgba(255,69,58,1)", "rgba(255,69,58,0.45)"]
}

function shortLabel(l: string): string {
  if (l.indexOf("周") >= 0) return "周额度"
  if (l.indexOf("5") >= 0) return "5小时"
  return l.length > 6 ? l.slice(0, 6) : l
}

function worstRow(rows: Row[]): Row | null {
  if (!rows.length) return null
  return rows.reduce((a, b) => (100 - b.pct) < (100 - a.pct) ? b : a)
}

/* 弹性进度条:原生 ProgressView,宽度自动撑满容器,比例由系统计算,不依赖固定宽 */
function Bar({ pct, colors, h }: { pct: number; colors: [string, string]; h?: number }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <VStack frame={{ maxWidth: "infinity", height: h ?? 6, alignment: "center" }}>
      <ProgressView value={p} total={100} tint={colors[0] as any} />
    </VStack>
  )
}

function Badge({ size, icon }: { size: number; icon: string }) {
  return (
    <VStack frame={{ width: size, height: size, alignment: "center" }} background={{ style: "rgba(28,30,35,1)", shape: { type: "rect", cornerRadius: size * 0.3 } } as any}>
      <Image systemName={icon} frame={{ width: size * 0.55, height: size * 0.55 }} foregroundStyle="white" />
    </VStack>
  )
}

/* 单账号(小尺寸) */
function SmallW({ rows }: { rows: Row[] }) {
  const worst = worstRow(rows)
  if (!worst) return <Placeholder text="暂无数据" icon="gauge" />
  const rem = Math.max(0, 100 - worst.pct)
  const [c1, c2] = remRGB(rem)
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 12 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <Badge size={20} icon="gauge" />
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">{worst.countdown ? worst.countdown : ""}</Text>
      </HStack>
      <Spacer />
      <HStack alignment="firstTextBaseline" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}>
        <Text font={42} foregroundStyle={c1 as any} fontWeight="bold">{rem.toFixed(0)}</Text>
        <Text font={15} foregroundStyle={c1 as any} fontWeight="bold">%</Text>
      </HStack>
      <Text font="caption2" foregroundStyle="secondaryLabel">剩余 · {worst.label}</Text>
      <Spacer />
      <Bar pct={rem} colors={[c1, c2]} h={6} />
    </VStack>
  )
}

/* 多账号(小尺寸):左右分屏,每格显示该账号最紧张窗口 */
function DualSmallW({ states }: { states: AcctState[] }) {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 12, vertical: 11 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <Badge size={17} icon="gauge" />
        <Spacer minLength={4} />
        <Text font="caption2" foregroundStyle="tertiaryLabel" fontWeight="medium">Kimi Code × {states.length}</Text>
      </HStack>
      <Spacer minLength={0} />
      <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {states.slice(0, 2).map((st, i) => {
          const w = worstRow(st.rows)
          const rem = w ? Math.max(0, 100 - w.pct) : null
          const [c1, c2] = remRGB(rem ?? 0)
          return (
            <HStack key={i} spacing={0} frame={{ maxWidth: "infinity", alignment: "center" }}>
              {i > 0 ? <VStack frame={{ width: 1, height: 44 }} background={"separator" as any} /> : null}
              <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "center" }} padding={{ leading: i > 0 ? 7 : 0 }}>
                <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>{st.acc.name}</Text>
                {w ? (
                  <HStack alignment="firstTextBaseline" spacing={1} frame={{ maxWidth: "infinity", alignment: "center" }}>
                    <Text font={24} foregroundStyle={c1 as any} fontWeight="bold">{rem!.toFixed(0)}</Text>
                    <Text font={11} foregroundStyle={c1 as any} fontWeight="bold">%</Text>
                  </HStack>
                ) : (
                  <Text font="caption2" foregroundStyle="systemRed">{st.error ? "失败" : "暂无"}</Text>
                )}
                <Bar pct={rem ?? 0} colors={[c1, c2]} h={5} />
              </VStack>
            </HStack>
          )
        })}
      </HStack>
      <Spacer minLength={0} />
      <Text font="caption2" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>
        {states[0] && worstRow(states[0].rows)?.countdown ? `${worstRow(states[0].rows)!.countdown} 后重置` : ""}
      </Text>
    </VStack>
  )
}

/* 账号列(中/大尺寸):左列/右列,内含窗口行 */
function AcctCol({ st, maxWins, withDivider }: { st: AcctState; maxWins: number; withDivider: boolean }) {
  const wins = st.error
    ? []
    : st.rows.slice().sort((a, b) => (100 - a.pct) - (100 - b.pct)).slice(0, maxWins)
  return (
    <HStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
      {withDivider ? <VStack frame={{ width: 1, maxHeight: "infinity" }} background={"separator" as any} /> : null}
      <VStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }} padding={{ leading: withDivider ? 9 : 0 }}>
        <HStack frame={{ maxWidth: "infinity" }} alignment="center">
          <Text font="caption2" foregroundStyle="label" fontWeight="bold" lineLimit={1}>{st.acc.name}</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="tertiaryLabel">{wins[0]?.countdown ? wins[0].countdown : ""}</Text>
        </HStack>
        {st.error ? (
          <Text font="caption2" foregroundStyle="systemRed" lineLimit={2}>{st.error}</Text>
        ) : wins.map((r, i) => {
          const rem = Math.max(0, 100 - r.pct)
          const [c1, c2] = remRGB(rem)
          return (
            <VStack key={i} spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
                <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>{shortLabel(r.label)}</Text>
                <Spacer />
                <Text font={14} foregroundStyle={c1 as any} fontWeight="bold">{rem.toFixed(0)}%</Text>
              </HStack>
              <Bar pct={rem} colors={[c1, c2]} h={5} />
            </VStack>
          )
        })}
      </VStack>
    </HStack>
  )
}

/* 多账号(中/大尺寸):左右双列 */
function MultiW({ states }: { states: AcctState[] }) {
  const list = states.slice(0, 2)
  const maxWins = Widget.family === "systemMedium" ? 2 : 3
  const only = list.length === 1 ? list[0] : null
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 11 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="center">
        <HStack spacing={5} alignment="center">
          <Badge size={18} icon="gauge" />
          <Text font={11} foregroundStyle="label" fontWeight="bold">Kimi Code 额度</Text>
        </HStack>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">{list.length > 1 ? `${list.length} 账号` : (only && worstRow(only.rows)?.countdown ? `${worstRow(only.rows)!.countdown} 后重置` : "")}</Text>
      </HStack>
      <Spacer minLength={8} />
      <HStack spacing={0} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {list.map((st, i) => <AcctCol key={i} st={st} maxWins={maxWins} withDivider={i > 0} />)}
      </HStack>
      <Spacer minLength={8} />
    </VStack>
  )
}

function Placeholder({ text, icon }: { text: string; icon: string }) {
  return (
    <VStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={16}>
      <Image systemName={icon} frame={{ width: 30, height: 30 }} foregroundStyle="systemOrange" />
      <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>{text}</Text>
    </VStack>
  )
}

async function main() {
  const accounts = loadAccounts()
  if (!accounts.length) {
    Widget.present(<Placeholder text="请先在 App 中添加 API Key" icon="key.fill" />)
    return
  }
  const states: AcctState[] = await Promise.all(accounts.map(async acc => {
    try {
      const headers = { "Authorization": `Bearer ${acc.key}`, "User-Agent": "KimiCLI/1.6" }
      let r = await fetch(`${BASE}/usages`, { headers })
      if (r.status === 404) r = await fetch(`${BASE}/usage`, { headers })
      let body: any = null
      try { body = await r.json() } catch { body = null }
      if (!r.ok) {
        const msg = r.status === 401 ? "Key 无效(需 sk-kimi-)" : `HTTP ${r.status}`
        return { acc, rows: [], error: msg }
      }
      const rows = parseRows(body)
      return { acc, rows, error: rows.length ? "" : "未解析到数据" }
    } catch {
      return { acc, rows: [], error: "网络请求失败" }
    }
  }))

  Widget.present(
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {Widget.family === "systemSmall" ? (
        states.length === 1 ? <SmallW rows={states[0].rows} /> : <DualSmallW states={states} />
      ) : (
        <MultiW states={states} />
      )}
    </VStack>
  )
}

main()