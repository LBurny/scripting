import { Script, Navigation, NavigationStack, List, Section, VStack, HStack, Text, Image, Button, TextField, Picker, Spacer, ProgressView, useState, useEffect, fetch } from 'scripting'

const BASE = "https://api.kimi.com/coding/v1"
const OLLAMA_BASE = "https://ollama.com/api"
const KEY_LIST = "kimi_code_keys"
const KEY_OLLAMA = "ollama_keys" // 与独立「Ollama 额度」脚本共享同一份 Key 列表
const KEY_LEGACY = "kimi_code_api_key"

type Provider = "kimi" | "ollama"
interface Account { key: string; name: string; provider: Provider }
interface Row { label: string; used: number; limit: number; pct: number; resetAt: string; countdown: string }
// Ollama 用量:session(5小时)/weekly(周)窗口为已用百分比,另附 Extra 余额
interface Mdl { name: string; count: number }
interface Win { pct: number; models: Mdl[] }
interface OllamaUsage { session: Win | null; weekly: Win | null; balance: number | null }
interface AcctState { acc: Account; rows: Row[]; usage: OllamaUsage | null; plan: string; error: string }

function num(v: any): number | null {
  const n = parseInt(v)
  return isNaN(n) ? null : n
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

function maskKey(k: string): string {
  return k.length > 16 ? `${k.slice(0, 10)}…${k.slice(-4)}` : k
}

function parseStored(raw: string | null, provider: Provider): Account[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((a: any) => a && typeof a.key === "string" && a.key).map((a: any, i: number) => ({ key: String(a.key), name: String(a.name || `Key ${i + 1}`), provider }))
  } catch { return [] }
}

function loadAccounts(): Account[] {
  let kimi = parseStored(Storage.get<string>(KEY_LIST), "kimi")
  if (!kimi.length) {
    const legacy = (Storage.get<string>(KEY_LEGACY) || "").trim()
    if (legacy) kimi = [{ key: legacy, name: "Key 1", provider: "kimi" }]
  }
  return [...kimi, ...parseStored(Storage.get<string>(KEY_OLLAMA), "ollama")]
}

function saveAccounts(list: Account[]) {
  const strip = (p: Provider) => list.filter(a => a.provider === p).map(a => ({ key: a.key, name: a.name }))
  Storage.set(KEY_LIST, JSON.stringify(strip("kimi")))
  Storage.set(KEY_OLLAMA, JSON.stringify(strip("ollama")))
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

// ---- Ollama 额度(参考 ollama-quota 脚本) ----
function parseWin(w: any): Win | null {
  if (!w || typeof w !== "object" || typeof w.usage !== "number") return null
  const models: Mdl[] = Array.isArray(w.models)
    ? w.models.map((m: any) => ({ name: String(m?.name ?? "?"), count: Number(m?.request_count ?? 0) }))
    : []
  const pct = Math.round(Math.max(0, Math.min(100, w.usage * 100)) * 10) / 10
  return { pct, models }
}

function parseOllamaUsage(payload: any): OllamaUsage | null {
  if (!payload || typeof payload !== "object") return null
  const limits = payload.limits
  const session = limits && typeof limits === "object" ? parseWin(limits.session) : null
  const weekly = limits && typeof limits === "object" ? parseWin(limits.weekly) : null
  let balance: number | null = null
  const act = payload.activity
  if (act && typeof act === "object" && act.cost != null) {
    const n = parseFloat(act.cost)
    if (!isNaN(n)) balance = n
  }
  if (!session && !weekly) return null
  return { session, weekly, balance }
}

// Ollama 周额度按 UTC 周一 0 点重置(接口不返回重置时间,本地估算)
function nextMondayUtcTs(nowMs: number): number {
  const d = new Date(nowMs)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const add = (8 - d.getUTCDay()) % 7 || 7
  return midnight + add * 86400000
}

function ollamaWeeklyCountdown(): string {
  const diff = nextMondayUtcTs(Date.now()) - Date.now()
  if (diff <= 0) return "已重置"
  const days = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const cd = days > 0 ? `${days}天${h}小时${m}分` : h > 0 ? `${h}小时${m}分` : `${m}分钟`
  return cd
}

function fmtMoney(v: number | null): string {
  if (v === null) return "—"
  return v % 1 === 0 ? `$${v}` : `$${v.toFixed(2)}`
}

function modelsLine(models: Mdl[], max = 3): string {
  if (!models.length) return "暂无模型请求"
  const top = models.slice(0, max).map(m => `${m.name} ×${m.count}`)
  return models.length > max ? `${top.join(" · ")} +${models.length - max}` : top.join(" · ")
}

async function fetchOllama(key: string): Promise<{ usage: OllamaUsage | null; plan: string; error: string }> {
  try {
    const r = await fetch(`${OLLAMA_BASE}/usage`, { headers: { "Authorization": `Bearer ${key}` } })
    if (!r.ok) {
      const hints: Record<number, string> = {
        401: "Key 无效或已过期(401)",
        403: "无权限访问(403)。",
        429: "请求过于频繁(429),请稍后重试。"
      }
      return { usage: null, plan: "", error: hints[r.status] || `接口错误 HTTP ${r.status}` }
    }
    let body: any = null
    try { body = await r.json() } catch { body = null }
    const usage = parseOllamaUsage(body)
    if (!usage) return { usage: null, plan: "", error: "未解析到用量数据(响应结构可能已变化)" }
    let plan = ""
    try {
      const m = await fetch(`${OLLAMA_BASE}/me`, { method: "POST", headers: { "Authorization": `Bearer ${key}` } })
      if (m.ok) { const b: any = await m.json(); plan = String(b?.Plan ?? "") }
    } catch {}
    return { usage, plan, error: "" }
  } catch (e: any) {
    return { usage: null, plan: "", error: `网络请求失败:${String(e?.message || e || "未知错误")}` }
  }
}

async function fetchAccount(acc: Account): Promise<{ rows: Row[]; usage: OllamaUsage | null; plan: string; error: string }> {
  if (acc.provider === "ollama") {
    const r = await fetchOllama(acc.key)
    return { rows: [], usage: r.usage, plan: r.plan, error: r.error }
  }
  const r = await fetchUsage(acc.key)
  return { rows: r.rows, usage: null, plan: "", error: r.error }
}

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

export function OllamaWinRow({ label, win, countdown }: { label: string; win: Win; countdown?: string }) {
  const rem = Math.max(0, 100 - win.pct)
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }} padding={{ top: 6, leading: 14, bottom: 10, trailing: 14 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
        <Text font="subheadline" foregroundStyle="label" fontWeight="semibold">{label}</Text>
        <Spacer />
        <Text font={30} foregroundStyle={remColor(rem) as any} fontWeight="bold">{rem.toFixed(0)}%</Text>
      </HStack>
      <ProgressView value={Math.min(100, win.pct)} total={100} tint={remColor(rem) as any} />
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1} minScaleFactor={0.8}>已用 {win.pct.toFixed(1)}% · {modelsLine(win.models)}</Text>
        <Spacer />
        <Text font="footnote" foregroundStyle="secondaryLabel">{countdown ? `${countdown}后重置` : ""}</Text>
      </HStack>
    </VStack>
  )
}

export function Page() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [states, setStates] = useState<(AcctState | null)[]>(() => loadAccounts().map(() => null))
  const [newProvider, setNewProvider] = useState<Provider>("kimi")
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
    const rs = await Promise.all(accs.map(a => fetchAccount(a)))
    setStates(rs.map((r, i) => ({ acc: accs[i], rows: r.rows, usage: r.usage, plan: r.plan, error: r.error })))
    if (rs.some(x => !x.error)) markTime()
    setLoading(false)
  }

  function addAccount() {
    const v = newKey.trim()
    if (!v) { setErr("请输入 API Key"); return }
    if (v.length < 10) { setErr("Key 格式不正确"); return }
    if (accounts.some(a => a.key === v && a.provider === newProvider)) { setErr("该 Key 已存在"); return }
    const acc: Account = { key: v, name: newName.trim() || `Key ${accounts.length + 1}`, provider: newProvider }
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
    fetchAccount(acc).then(res => {
      setStates(prev => {
        const n: (AcctState | null)[] = (prev || []).slice()
        n[accounts.length] = { acc, rows: res.rows, usage: res.usage, plan: res.plan, error: res.error }
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
        navigationTitle="Code Credit"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarTrailing: <Button action={() => refreshAll(accounts)}><Image systemName="arrow.clockwise" /></Button>,
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        {accounts.length && !loading && states.some(s => s && !s.error && (s.rows.length > 0 || s.usage !== null)) ? (
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
              footer={<Text font="caption2" foregroundStyle="tertiaryLabel">{a.provider === "ollama" ? "Ollama" : "Kimi Code"} · {maskKey(a.key)}{st?.plan ? ` · ${st.plan.toUpperCase()}` : ""}</Text>}
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
              ) : a.provider === "ollama" && st.usage ? (
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  {st.usage.session ? <OllamaWinRow label="5小时" win={st.usage.session} /> : null}
                  {st.usage.weekly ? <OllamaWinRow label="周额度" win={st.usage.weekly} countdown={ollamaWeeklyCountdown()} /> : null}
                  <HStack spacing={6} frame={{ maxWidth: "infinity" }} padding={{ top: 2, leading: 14, bottom: 8, trailing: 14 }}>
                    <Image systemName="dollarsign.circle" frame={{ width: 14, height: 14 }} foregroundStyle="secondaryLabel" />
                    <Text font="footnote" foregroundStyle="secondaryLabel">Extra 余额</Text>
                    <Spacer />
                    <Text font="footnote" foregroundStyle="label" fontWeight="semibold" monospacedDigit>{fmtMoney(st.usage.balance)}</Text>
                  </HStack>
                </VStack>
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
              <Text font="footnote" foregroundStyle="secondaryLabel">添加 Kimi / Ollama API Key 后自动加载(支持多个)</Text>
            </VStack>
          </Section>
        ) : null}

        <Section
          header={<Text font="headline">添加账号</Text>}
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">{newProvider === "kimi" ? "必须是 Kimi Code 控制台创建的 Key(sk-kimi-开头),不是 Kimi 开放平台(platform.kimi.com)的 sk- Key,两者不互通" : "Ollama Key 在 ollama.com/settings/keys 创建;与「Ollama 额度」脚本共享 Key 列表,粘贴后自动拉取用量"}</Text>}
        >
          <Picker title="平台" pickerStyle="segmented" value={newProvider} onChanged={(v: string) => { setNewProvider(v as Provider); setErr("") }}>
            <Text tag="kimi">Kimi</Text>
            <Text tag="ollama">Ollama</Text>
          </Picker>
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
            prompt={newProvider === "kimi" ? "sk-kimi-..." : "粘贴 Ollama API Key"}
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