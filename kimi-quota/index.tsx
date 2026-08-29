import { Script, Navigation, NavigationStack, List, Section, VStack, HStack, Text, Image, Button, TextField, Spacer, ProgressView, useState, useEffect, fetch } from 'scripting'

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

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

function maskKey(k: string): string {
  return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k
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

function saveAccounts(list: Account[]) {
  Storage.set(KEY_LIST, JSON.stringify(list))
  if (list.length && Storage.get<string>(KEY_LEGACY)) Storage.remove(KEY_LEGACY)
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
    const dd = new Date(ts)
    const at = `${dd.getMonth() + 1}-${dd.getDate()} ${pad2(dd.getHours())}:${pad2(dd.getMinutes())}`
    if (diff <= 0) return { at, cd: "已重置" }
    const days = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return { at, cd: `${days}天${h}小时${m}分` }
    if (h > 0) return { at, cd: `${h}小时${m}分` }
    return { at, cd: `${m}分钟` }
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

async function fetchUsage(key: string): Promise<FetchResult> {
  const headers = { "Authorization": `Bearer ${key}`, "User-Agent": "KimiCLI/1.6" }
  try {
    let r = await fetch(`${BASE}/usages`, { headers })
    if (r.status === 404) r = await fetch(`${BASE}/usage`, { headers })
    let body: any = null
    try { body = await r.json() } catch { body = null }
    if (!r.ok) {
      const hints: Record<number, string> = {
        401: "认证失败(401):需要 Kimi Code 平台的 Key(sk-kimi-xxx)",
        403: "无权限访问用量接口(403)。",
        404: "用量接口不存在(404)。",
        429: "请求过于频繁(429),请稍后重试。"
      }
      return { rows: [], error: hints[r.status] || `接口错误 HTTP ${r.status}` }
    }
    const rows = parseRows(body)
    if (!rows.length) return { rows: [], error: "未解析到用量数据(响应结构可能已变化)" }
    return { rows, error: "" }
  } catch (e: any) {
    return { rows: [], error: `网络请求失败:${String(e?.message || e || "未知错误")}` }
  }
}

interface FetchResult { rows: Row[]; error: string }

function fmtN(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿"
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万"
  return String(Math.round(n))
}

function remColor(remPct: number): string {
  if (remPct >= 50) return "systemGreen"
  if (remPct >= 30) return "systemYellow"
  if (remPct >= 15) return "systemOrange"
  return "systemRed"
}

function Page() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [states, setStates] = useState<(AcctState | null)[]>(() => loadAccounts().map(() => null))
  const [newKey, setNewKey] = useState("")
  const [newName, setNewName] = useState("")
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState("")
  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    refreshAll(loadAccounts())
  }, [])

  function markTime() {
    const d = new Date()
    setUpdatedAt(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
  }

  async function refreshAll(accs: Account[]) {
    if (!accs.length) { setLoading(false); return }
    setLoading(true)
    const rs = await Promise.all(accs.map(a => fetchUsage(a.key)))
    setStates(rs.map((r, i) => ({ acc: accs[i], rows: r.rows, error: r.error })))
    if (rs.some(x => !x.error)) markTime()
    setLoading(false)
  }

  function addAccount() {
    const v = newKey.trim()
    if (!v) { setErr("请输入 API Key"); return }
    if (v.length < 10) { setErr("Key 格式不正确"); return }
    if (accounts.some(a => a.key === v)) { setErr("该 Key 已存在"); return }
    const acc: Account = { key: v, name: newName.trim() || `Key ${accounts.length + 1}` }
    const list = [...accounts, acc]
    saveAccounts(list)
    setAccounts(list)
    setStates(prev => {
      const n: (AcctState | null)[] = list.map((_, i) => (i < accounts.length && prev ? prev[i] : null))
      return n
    })
    setNewKey(""); setNewName(""); setErr("")
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
    setLoading(true)
    fetchUsage(v).then(res => {
      setStates(prev => {
        const n: (AcctState | null)[] = (prev || []).slice()
        n[accounts.length] = { acc, rows: res.rows, error: res.error }
        return n
      })
      if (!res.error) markTime()
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  function removeAccount(i: number) {
    const list = accounts.filter((_, j) => j !== i)
    saveAccounts(list)
    setAccounts(list)
    setStates(prev => (prev || []).filter((_, j) => j !== i))
  }

  function doClear() {
    saveAccounts([])
    Storage.remove(KEY_LEGACY)
    setAccounts([]); setStates([]); setErr(""); setNewKey(""); setNewName(""); setUpdatedAt("")
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Kimi 额度"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarTrailing: <Button action={() => refreshAll(accounts)}><Image systemName="arrow.clockwise" /></Button>,
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        {accounts.length && !loading && states.some(s => s && s.rows.length) ? (
          <Section>
            <HStack spacing={6} padding={{ vertical: 2 }}>
              <Image systemName="checkmark.circle.fill" frame={{ width: 13, height: 13 }} foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="secondaryLabel">{accounts.length} 个账号已连接{updatedAt ? ` · ${updatedAt} 更新` : ""}</Text>
            </HStack>
          </Section>
        ) : null}

        {accounts.map((a, i) => {
          const st = states[i]
          return (
            <Section
              key={i}
              header={<Text font="headline">{a.name}</Text>}
              footer={<Text font="caption2" foregroundStyle="tertiaryLabel">{maskKey(a.key)}</Text>}
            >
              {!st || loading ? (
                <HStack spacing={6} padding={{ vertical: 6 }}>
                  <Text font="footnote" foregroundStyle="secondaryLabel">加载中…</Text>
                </HStack>
              ) : st.error ? (
                <HStack spacing={6} padding={{ vertical: 4 }}>
                  <Image systemName="exclamationmark.triangle.fill" frame={{ width: 13, height: 13 }} foregroundStyle="systemRed" />
                  <Text font="footnote" foregroundStyle="systemRed">{st.error}</Text>
                </HStack>
              ) : st.rows.map((r, j) => {
                const rem = Math.max(0, 100 - r.pct)
                return (
                  <VStack key={j} spacing={8} frame={{ maxWidth: "infinity" }} padding={{ top: 6, leading: 14, bottom: 10, trailing: 14 }}>
                    <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
                      <Text font="subheadline" foregroundStyle="label" fontWeight="semibold">{r.label}</Text>
                      <Spacer />
                      <Text font={30} foregroundStyle={remColor(rem) as any} fontWeight="bold">{rem.toFixed(0)}%</Text>
                    </HStack>
                    <ProgressView value={Math.min(100, r.pct)} total={100} tint={remColor(rem) as any} />
                    <HStack frame={{ maxWidth: "infinity" }}>
                      <Text font="footnote" foregroundStyle="secondaryLabel">已用 {fmtN(r.used)} / {fmtN(r.limit)}</Text>
                      <Spacer />
                      <Text font="footnote" foregroundStyle="secondaryLabel">{r.countdown ? `${r.resetAt} · ${r.countdown}后重置` : r.resetAt}</Text>
                    </HStack>
                  </VStack>
                )
              })}
              <Button title="删除此账号" action={() => removeAccount(i)} role="destructive" />
            </Section>
          )
        })}

        {!accounts.length ? (
          <Section>
            <VStack spacing={8} frame={{ maxWidth: "infinity" }} alignment="center" padding={{ top: 26, bottom: 26 }}>
              <Image systemName={loading ? "ellipsis" : "gauge"} frame={{ width: 34, height: 34 }} foregroundStyle="secondaryLabel" />
              <Text font="footnote" foregroundStyle="secondaryLabel">添加 API Key 后自动加载(支持多个)</Text>
            </VStack>
          </Section>
        ) : null}

        <Section
          header={<Text font="headline">添加账号</Text>}
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">必须是 Kimi Code 控制台创建的 Key(sk-kimi-开头),不是 Kimi 开放平台(platform.kimi.com)的 sk- Key,两者不互通</Text>}
        >
          <TextField
            title="备注名(可选)"
            value={newName}
            onChanged={(v) => { setNewName(v); setErr("") }}
            prompt="如:主力号 / 备用号"
          />
          <TextField
            title="API Key"
            value={newKey}
            onChanged={(v) => { setNewKey(v); setErr("") }}
            prompt="sk-kimi-..."
          />
          {err ? (
            <HStack spacing={4}>
              <Image systemName="exclamationmark.triangle.fill" frame={{ width: 12, height: 12 }} foregroundStyle="systemRed" />
              <Text font="caption" foregroundStyle="systemRed">{err}</Text>
            </HStack>
          ) : null}
          <Button title={added ? "已添加 ✓" : "添加账号"} action={addAccount} />
          {accounts.length ? <Button title="清除全部" action={doClear} role="destructive" /> : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()