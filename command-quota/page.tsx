// page.tsx — Command 额度 App 页（供 index.tsx 与 preview-page.tsx 复用）
import { Navigation, NavigationStack, List, Section, VStack, HStack, Text, Image, Button, TextField, Spacer, ProgressView, useState, useEffect } from 'scripting'
import { Account, Usage, loadAccounts, saveAccounts, fetchQuota, remColor, fmtMoney, fmtTokens, maskKey, resetShort, daysLeft, pad2 } from './core'

interface AcctState { acc: Account; usage: Usage | null }

export function UsageRow({ label, pct, reset }: { label: string; pct: number; reset?: string }) {
  const c = remColor(pct)
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }} padding={{ top: 6, leading: 14, bottom: 10, trailing: 14 }}>
      <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
        <Text font="subheadline" foregroundStyle="label" fontWeight="semibold">{label}</Text>
        <Spacer />
        <Text font={28} foregroundStyle={c as any} fontWeight="bold">{pct.toFixed(1)}%</Text>
      </HStack>
      <ProgressView value={Math.min(100, pct)} total={100} tint={c as any} />
      {reset ? (
        <HStack frame={{ maxWidth: "infinity" }} alignment="firstTextBaseline">
          <Spacer />
          <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>{reset}</Text>
        </HStack>
      ) : null}
    </VStack>
  )
}

export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <VStack
      spacing={1}
      frame={{ maxWidth: "infinity" }}
      padding={{ vertical: 7 }}
      background={{ style: { light: "rgba(120,120,128,0.10)", dark: "rgba(120,120,128,0.18)" }, shape: "capsule" }}
    >
      <Text font="subheadline" foregroundStyle="label" fontWeight="semibold" monospacedDigit lineLimit={1} minScaleFactor={0.7}>{value}</Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1} minScaleFactor={0.8}>{label}</Text>
    </VStack>
  )
}

export function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <HStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 4 }} spacing={6}>
      <Image systemName={icon} frame={{ width: 14, height: 14 }} foregroundStyle="secondaryLabel" />
      <Text font="footnote" foregroundStyle="secondaryLabel">{label}</Text>
      <Spacer />
      <Text font="footnote" foregroundStyle="label" fontWeight="semibold" monospacedDigit>{value}</Text>
    </HStack>
  )
}

export function Page() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [states, setStates] = useState<(AcctState | null)[]>(() => loadAccounts().map(() => null))
  const [newKey, setNewKey] = useState("")
  const [newName, setNewName] = useState("")
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState("")
  const [now, setNow] = useState(Date.now())
  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    refreshAll(loadAccounts())
    // 运行时无 setInterval，用递归 setTimeout 推进倒计时显示
    let alive = true
    let t: any = null
    const tick = () => {
      if (!alive) return
      setNow(Date.now())
      t = setTimeout(tick, 30000)
    }
    t = setTimeout(tick, 30000)
    return () => {
      alive = false
      try { if (t && typeof clearTimeout === "function") clearTimeout(t) } catch {}
    }
  }, [])

  function markTime() {
    const d = new Date()
    setUpdatedAt(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
  }

  async function refreshAll(accs: Account[]) {
    if (!accs.length) { setLoading(false); return }
    setLoading(true)
    setNow(Date.now())
    const us = await Promise.all(accs.map(a => fetchQuota(a.key)))
    setStates(us.map((u, i) => ({ acc: accs[i], usage: u })))
    if (us.some(x => !x.error)) markTime()
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
    setStates(prev => (prev || []).slice(0, list.length))
    setNewKey(""); setNewName(""); setErr("")
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
    setLoading(true)
    fetchQuota(v).then(u => {
      setStates(prev => {
        const n = (prev || []).slice()
        n[list.length - 1] = { acc, usage: u }
        return n
      })
      if (!u.error) markTime()
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
    setAccounts([]); setStates([]); setErr(""); setNewKey(""); setNewName(""); setUpdatedAt("")
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Command 额度"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarTrailing: <Button action={() => refreshAll(accounts)}><Image systemName="arrow.clockwise" /></Button>,
          cancellationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        {accounts.length && !loading && states.some(s => s && s.usage && !s.usage.error) ? (
          <Section>
            <HStack spacing={6} padding={{ vertical: 2 }}>
              <Image systemName="checkmark.circle.fill" frame={{ width: 13, height: 13 }} foregroundStyle="systemGreen" />
              <Text font="caption" foregroundStyle="secondaryLabel">{accounts.length} 个账号已连接{updatedAt ? ` · ${updatedAt} 更新` : ""}</Text>
            </HStack>
          </Section>
        ) : null}

        {accounts.map((a, i) => {
          const st = states[i]
          const u = st?.usage ?? null
          const dl = u ? daysLeft(u.periodEnd, now) : null
          return (
            <Section
              key={i}
              header={<Text font="headline">{a.name}</Text>}
              footer={<Text font="caption2" foregroundStyle="tertiaryLabel">
                {maskKey(a.key)}{u?.userName ? ` · ${u.userName}` : ""}{u?.orgName ? ` · ${u.orgName}` : ""}{u?.plan ? ` · ${u.plan}` : ""}{u?.status && u.status !== "active" ? ` · ${u.status}` : ""}
              </Text>}
            >
              {!st || loading || !u ? (
                <HStack spacing={6} padding={{ vertical: 6 }}>
                  <Text font="footnote" foregroundStyle="secondaryLabel">加载中…</Text>
                </HStack>
              ) : u.error ? (
                <HStack spacing={6} padding={{ vertical: 4 }}>
                  <Image systemName="exclamationmark.triangle.fill" frame={{ width: 13, height: 13 }} foregroundStyle="systemRed" />
                  <Text font="footnote" foregroundStyle="systemRed">{u.error}</Text>
                </HStack>
              ) : (
                <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                  <UsageRow
                    label="5 小时"
                    pct={u.five ? u.five.pct : 0}
                    reset={u.five ? resetShort(u.five, now) : ""}
                  />
                  <UsageRow
                    label="周额度"
                    pct={u.weekly ? u.weekly.pct : 0}
                    reset={u.weekly ? resetShort(u.weekly, now) : ""}
                  />

                  <VStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ horizontal: 14, vertical: 4 }}>
                    <InfoRow icon="dollarsign.circle" label="订阅月额度剩余" value={`${fmtMoney(u.monthlyRemaining)}${u.planMonthly != null ? ` / ${fmtMoney(u.planMonthly)}` : ""}`} />
                    {dl != null ? <InfoRow icon="calendar" label="计费周期" value={`剩 ${dl} 天`} /> : null}
                    <InfoRow icon="plus.circle" label="额外额度剩余" value={fmtMoney(u.extraRemaining)} />
                  </VStack>
                  <VStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ leading: 14, trailing: 14, top: 4, bottom: 10 }}>
                    <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                      <StatChip label="本周期请求" value={`${u.requests} 次`} />
                      <StatChip label="Tokens" value={fmtTokens(u.tokens)} />
                      <StatChip label="本周期花费" value={fmtMoney(u.totalSpent)} />
                    </HStack>
                  </VStack>
                </VStack>
              )}
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
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">Key 在 commandcode.ai/studio 的 API keys 创建,形如 user_…;仅用于本机查询用量</Text>}
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
            prompt="粘贴 Command Code API Key"
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
