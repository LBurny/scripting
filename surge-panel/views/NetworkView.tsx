// 请求 Tab：活动 / 最近 / 事件 / DNS / 规则 顶部分段工作台
import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  Picker,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  flushDns,
  getActiveRequests,
  getDns,
  getEvents,
  getRecentRequests,
  killRequest,
  testDnsDelay,
  type DnsEntry,
  type SurgeEvent,
  type SurgeRequest,
} from "../lib/surgeApi"
import { formatBytes, formatEventTime, formatRequestClock, formatRequestDateTime, formatSpeed, isRejectPolicy, surgeTimestampToMs } from "../lib/metrics"
import { useStoreSelector } from "../lib/store"
import { useTabAutoRefresh } from "../lib/liveCache"
import { RequestsSegmentBar } from "../components/RequestsSegmentBar"
import { connectErrorText } from "../lib/ui"
import { RulesView } from "./RulesView"

export function NetworkView() {
  const segment = useStoreSelector((s) => s.requestsSegment)

  // 同一组件承载两个分段，key 保证切换时重挂载（清掉旧列表与轮询闭包）
  if (segment === "active") return <RequestListView key="active" active />
  if (segment === "recent") return <RequestListView key="recent" active={false} />
  if (segment === "events") return <EventsView />
  if (segment === "dns") return <DnsView />
  return <RulesView />
}

function listTitle(title: string): string | undefined {
  return Script.env === "home_screen" ? undefined : title
}

function filterRequests(list: SurgeRequest[], query: string): SurgeRequest[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((r) => {
    const hay = `${r.URL} ${r.remoteHost ?? ""} ${r.policyName} ${r.rule ?? ""} ${r.method ?? ""}`.toLowerCase()
    return hay.includes(q)
  })
}

type StatusFilter = "all" | "failed" | "rejected"

function filterByStatus(list: SurgeRequest[], status: StatusFilter): SurgeRequest[] {
  if (status === "failed") return list.filter((r) => r.failed)
  if (status === "rejected") return list.filter((r) => r.rejected || isRejectPolicy(r.policyName))
  return list
}

function sortRequests(list: SurgeRequest[], sort: string, active?: boolean): SurgeRequest[] {
  const out = list.slice()
  if (sort === "url") {
    out.sort((a, b) => (a.remoteHost ?? a.URL).localeCompare(b.remoteHost ?? b.URL))
  } else if (sort === "size") {
    out.sort((a, b) => ((b.inBytes ?? 0) + (b.outBytes ?? 0)) - ((a.inBytes ?? 0) + (a.outBytes ?? 0)))
  } else {
    const t = (r: SurgeRequest) => (active ? r.startDate : (r.completedDate ?? r.startDate)) ?? 0
    out.sort((a, b) => t(b) - t(a))
  }
  return out
}

// ---------- 活动连接 / 最近请求（同一工作台，仅数据源与列尾不同） ----------

function RequestListView({ active }: { active: boolean }) {
  const config = useStoreSelector((s) => s.config)
  const [requests, setRequests] = useState<SurgeRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("time")
  const [status, setStatus] = useState<StatusFilter>("all")

  async function load() {
    try {
      const r = active ? await getActiveRequests(config) : await getRecentRequests(config)
      setRequests(r.requests.slice().reverse())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  useTabAutoRefresh(3, load)

  const shown = requests
    ? sortRequests(filterRequests(filterByStatus(requests, active ? "all" : status), query), sort, active)
    : null
  const emptyText = active
    ? query
      ? "无匹配连接"
      : "当前没有活动连接"
    : query || status !== "all"
      ? "无匹配请求"
      : "暂无最近请求"

  return (
    <List
      navigationTitle={listTitle(active ? "活动连接" : "最近请求")}
      refreshable={async () => { await load() }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <Section>
        <RequestsSegmentBar />
      </Section>
      <Section>
        <TextField title="搜索" value={query} onChanged={setQuery} prompt="URL / 主机 / 策略" />
        <Picker title="排序" value={sort} onChanged={setSort}>
          <Text tag="time">时间</Text>
          <Text tag="url">主机</Text>
          <Text tag="size">流量</Text>
        </Picker>
        {active ? null : (
          <Picker title="筛选" value={status} onChanged={(v: string) => setStatus(v as StatusFilter)}>
            <Text tag="all">全部</Text>
            <Text tag="failed">仅失败</Text>
            <Text tag="rejected">仅拒绝</Text>
          </Picker>
        )}
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{connectErrorText(error, "加载失败")}</Text>
        </Section>
      ) : null}
      {shown === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : shown.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">{emptyText}</Text>
        </Section>
      ) : (
        <Section
          footer={
            active ? <Text font={12}>点按查看详情，详情页可终止连接；下拉可刷新</Text> : undefined
          }
        >
          {shown.map((r) => (
            <NavigationLink
              key={r.id}
              destination={<RequestDetailView r={r} active={active} onKilled={load} />}
            >
              <RequestRow r={r} active={active} />
            </NavigationLink>
          ))}
        </Section>
      )}
    </List>
  )
}

// ---------- 请求行 / 详情 ----------

function RequestRow({ r, active }: { r: SurgeRequest; active?: boolean }) {
  const clock = formatRequestClock(active ? r.startDate : (r.completedDate ?? r.startDate))
  return (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        {r.failed ? (
          <Image systemName="xmark.octagon.fill" foregroundStyle="systemRed" font={12} />
        ) : r.rejected ? (
          <Image systemName="hand.raised.fill" foregroundStyle="systemOrange" font={12} />
        ) : null}
        <Text font={16} lineLimit={1} minScaleFactor={0.6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {r.remoteHost ?? r.URL}
        </Text>
        {clock ? (
          <Text font={12} foregroundStyle="tertiaryLabel">{clock}</Text>
        ) : null}
      </HStack>
      <HStack spacing={8}>
        <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>
          {active ? r.policyName : `${r.method ?? ""} ${r.policyName}`}
        </Text>
        <Spacer />
        {active ? (
          <>
            <Text font={12} foregroundStyle="systemBlue">{`↓${formatSpeed(r.inCurrentSpeed ?? 0)}`}</Text>
            <Text font={12} foregroundStyle="systemGreen">{`↑${formatSpeed(r.outCurrentSpeed ?? 0)}`}</Text>
          </>
        ) : (
          <Text font={12} foregroundStyle="secondaryLabel">
            {formatBytes((r.inBytes ?? 0) + (r.outBytes ?? 0))}
          </Text>
        )}
      </HStack>
      {r.rule ? (
        <Text font={12} foregroundStyle="tertiaryLabel" lineLimit={1}>{r.rule}</Text>
      ) : null}
    </VStack>
  )
}

function InfoRow({ label, value, selectable }: { label: string; value?: string | null; selectable?: boolean }) {
  if (value == null || value === "") return null
  return (
    <HStack spacing={8}>
      <Text font={13} foregroundStyle="secondaryLabel">{label}</Text>
      <Spacer />
      <Text font={13} lineLimit={selectable ? undefined : 2} minScaleFactor={0.7} multilineTextAlignment="trailing">
        {value}
      </Text>
    </HStack>
  )
}

const DETAIL_REFRESH_MS = 2000

function RequestDetailView({
  r,
  active,
  onKilled,
}: {
  r: SurgeRequest
  active?: boolean
  onKilled?: () => void
}) {
  const config = useStoreSelector((s) => s.config)
  const [showKill, setShowKill] = useState(false)
  const [killMsg, setKillMsg] = useState<string | null>(null)
  // 活动连接详情跟随刷新，不再是进入时的静态快照；从活动列表消失即视为已结束
  const [live, setLive] = useState<SurgeRequest>(r)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      getActiveRequests(config)
        .then((res) => {
          const found = res.requests.find((x) => x.id === r.id)
          if (found) {
            setLive(found)
          } else {
            setEnded(true)
            clearInterval(id)
          }
        })
        .catch(() => {})
    }, DETAIL_REFRESH_MS)
    return () => clearInterval(id)
  }, [config, r.id, active])

  const cur = active ? live : r
  const ongoing = Boolean(active) && !cur.completed && !ended

  async function doKill() {
    try {
      await killRequest(config, r.id)
      setKillMsg("已终止该连接")
      onKilled?.()
    } catch (e) {
      setKillMsg(`终止失败：${String(e)}`)
    }
  }

  return (
    <List
      navigationTitle="请求详情"
      confirmationDialog={{
        isPresented: showKill,
        onChanged: setShowKill,
        title: "确认终止该连接？",
        actions: <Button title="终止" role="destructive" action={doKill} />,
      }}
    >
      {/* 概览 */}
      <Section header={<Text>概览</Text>}>
        <VStack alignment="leading" spacing={3}>
          <Text font={12} foregroundStyle="secondaryLabel">完整地址</Text>
          <Text font={13}>{cur.URL}</Text>
        </VStack>
        <InfoRow label="方法" value={cur.method} />
        <InfoRow
          label="状态"
          value={cur.status ?? (cur.completed ? "已完成" : ended ? "已结束" : active ? "进行中" : undefined)}
        />
        <InfoRow label="策略" value={cur.policyName} />
        <InfoRow label="原始策略" value={cur.originalPolicyName !== cur.policyName ? cur.originalPolicyName : undefined} />
        <InfoRow label="匹配规则" value={cur.rule} />
        <InfoRow label="设备" value={cur.deviceName} />
        <InfoRow label="来源" value={cur.source} />
        <InfoRow label="远端" value={cur.remoteAddress ? `${cur.remoteAddress}${cur.remoteHost && cur.remoteHost !== cur.remoteAddress ? `（${cur.remoteHost}）` : ""}` : cur.remoteHost} />
        <InfoRow label="本机" value={cur.localAddress} />
        <InfoRow label="接口" value={cur.interface} />
        <InfoRow label="开始时间" value={formatRequestDateTime(cur.startDate)} />
        {cur.completedDate ? <InfoRow label="完成时间" value={formatRequestDateTime(cur.completedDate)} /> : null}
      </Section>

      {/* 流量 */}
      <Section header={<Text>流量</Text>}>
        <InfoRow label="下载总量" value={formatBytes(cur.inBytes ?? 0)} />
        <InfoRow label="上传总量" value={formatBytes(cur.outBytes ?? 0)} />
        {ongoing ? (
          <>
            <InfoRow label="实时下载" value={formatSpeed(cur.inCurrentSpeed ?? 0)} />
            <InfoRow label="实时上传" value={formatSpeed(cur.outCurrentSpeed ?? 0)} />
          </>
        ) : null}
        {cur.inMaxSpeed ? <InfoRow label="峰值下载" value={formatSpeed(cur.inMaxSpeed)} /> : null}
        {cur.outMaxSpeed ? <InfoRow label="峰值上传" value={formatSpeed(cur.outMaxSpeed)} /> : null}
      </Section>

      {/* 决策过程 */}
      {cur.notes && cur.notes.length > 0 ? (
        <Section header={<Text>决策过程</Text>}>
          {cur.notes.map((n, i) => (
            <Text key={i} font={12} lineLimit={3}>{n}</Text>
          ))}
        </Section>
      ) : null}

      {/* 耗时分解 */}
      {cur.timingRecords && cur.timingRecords.length > 0 ? (
        <Section header={<Text>耗时分解</Text>}>
          {cur.timingRecords.map((t, i) => (
            <HStack key={i}>
              <Text font={13}>{t.name}</Text>
              <Spacer />
              <Text font={13} foregroundStyle="secondaryLabel">
                {t.durationInMillisecond < 1 ? "<1 ms" : `${Math.round(t.durationInMillisecond)} ms`}
              </Text>
            </HStack>
          ))}
        </Section>
      ) : null}

      {/* 终止连接 */}
      {ongoing ? (
        <Section footer={killMsg ? <Text font={12}>{killMsg}</Text> : undefined}>
          <Button title="终止连接" role="destructive" systemImage="xmark.circle" action={() => setShowKill(true)} />
        </Section>
      ) : null}
    </List>
  )
}

// ---------- 事件中心 ----------

function EventsView() {
  const config = useStoreSelector((s) => s.config)
  const [events, setEvents] = useState<SurgeEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const r = await getEvents(config)
      setEvents(r.events.slice().reverse())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  useTabAutoRefresh(3, load)

  return (
    <List
      navigationTitle={listTitle("事件中心")}
      refreshable={async () => { await load() }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <Section>
        <RequestsSegmentBar />
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{connectErrorText(error, "加载失败")}</Text>
        </Section>
      ) : null}
      {events === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : events.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">暂无事件</Text>
        </Section>
      ) : (
        <Section>
          {events.map((e) => (
            <VStack key={e.identifier} alignment="leading" spacing={2}>
              <Text font={14} fontWeight="medium" lineLimit={4}>
                {e.content ?? e.identifier}
              </Text>
              <Text font={11} foregroundStyle="tertiaryLabel">
                {formatEventTime(e.date)}
              </Text>
            </VStack>
          ))}
        </Section>
      )}
    </List>
  )
}

// ---------- DNS 缓存 ----------

function DnsView() {
  const config = useStoreSelector((s) => s.config)
  const [cache, setCache] = useState<DnsEntry[] | null>(null)
  const [local, setLocal] = useState<DnsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFlush, setShowFlush] = useState(false)
  const [flushed, setFlushed] = useState(false)
  const [testDomain, setTestDomain] = useState("www.apple.com")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  async function runDnsTest() {
    const domain = testDomain.trim()
    if (!domain || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testDnsDelay(config, domain)
      setTestResult(`${domain} 解析延迟 ${Math.round((r?.delay ?? 0) * 1000)} ms`)
    } catch (e) {
      setTestResult(`测试失败：${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  async function load() {
    try {
      const r = await getDns(config)
      setCache(asDnsList(r.dnsCache))
      setLocal(asDnsList(r.local))
      setError(null)
      setFlushed(false)
    } catch (e) {
      setError(String(e))
    }
  }

  useTabAutoRefresh(3, load)

  async function doFlush() {
    try {
      await flushDns(config)
      setFlushed(true)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const shownLocal = local ? filterDns(local, query) : []
  const shownCache = cache ? filterDns(cache, query) : []

  return (
    <List
      navigationTitle={listTitle("DNS 缓存")}
      refreshable={async () => { await load() }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      confirmationDialog={{
        isPresented: showFlush,
        onChanged: setShowFlush,
        title: "清除全部 DNS 缓存？",
        actions: <Button title="清除" role="destructive" action={doFlush} />,
      }}
    >
      <Section>
        <RequestsSegmentBar />
      </Section>
      <Section>
        <TextField title="搜索" value={query} onChanged={setQuery} prompt="域名" />
      </Section>
      <Section
        header={<Text>DNS 延迟测试</Text>}
        footer={testResult ? <Text font={12}>{testResult}</Text> : undefined}
      >
        <TextField title="域名" value={testDomain} onChanged={setTestDomain} prompt="www.apple.com" />
        <Button
          title={testing ? "测试中…" : "测试解析延迟"}
          systemImage="timer"
          disabled={testing}
          action={runDnsTest}
        />
      </Section>
      <Section>
        <Button title="清除 DNS 缓存" systemImage="trash" role="destructive" action={() => setShowFlush(true)} />
        {flushed ? <Text font={12} foregroundStyle="systemGreen">已清除并重新加载</Text> : null}
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{connectErrorText(error, "加载失败")}</Text>
        </Section>
      ) : null}
      {cache === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : shownLocal.length > 0 ? (
        <Section header={<Text>{`静态 Host ${shownLocal.length}`}</Text>}>
          {shownLocal.map((e, i) => (
            <NavigationLink key={`local-${e.domain}-${i}`} destination={<DnsDetailView e={e} />}>
              <DnsRow e={e} />
            </NavigationLink>
          ))}
        </Section>
      ) : null}
      {cache === null ? null : (
        <Section
          header={<Text>{`${shownCache.length} 条动态缓存`}</Text>}
          footer={<Text font={12}>点按条目查看解析结果、CNAME 链路与查询日志。静态 Host 来自配置 [Host]，动态缓存有上限约 200。</Text>}
        >
          {shownCache.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">{query ? "无匹配缓存" : "暂无缓存"}</Text>
          ) : (
            shownCache.map((e, i) => (
              <NavigationLink key={`cache-${e.domain}-${i}`} destination={<DnsDetailView e={e} />}>
                <DnsRow e={e} />
              </NavigationLink>
            ))
          )}
        </Section>
      )}
    </List>
  )
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0)
  if (typeof v === "string" && v.length > 0) return [v]
  return []
}

function asDnsList(v: unknown): DnsEntry[] {
  if (!Array.isArray(v)) return []
  return v.map((raw) => {
    const e = raw as DnsEntry
    const path = (e as { path?: unknown }).path
    return {
      ...e,
      domain: String(e.domain ?? ""),
      data: asStringList(e.data),
      logs: asStringList(e.logs),
      path: Array.isArray(path) ? asStringList(path).join(" → ") : e.path,
    }
  })
}

function filterDns(list: DnsEntry[], query: string): DnsEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (e) =>
      e.domain.toLowerCase().includes(q) ||
      asStringList(e.data).some((d) => d.toLowerCase().includes(q))
  )
}

function DnsRow({ e }: { e: DnsEntry }) {
  const records = asStringList(e.data)
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font={14} lineLimit={1} minScaleFactor={0.7}>{e.domain}</Text>
      <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
        {`${records.length > 0 ? records.join("、") : "—"} · ${e.server ?? e.comment ?? ""}`}
      </Text>
    </VStack>
  )
}

function DnsDetailView({ e }: { e: DnsEntry }) {
  const records = asStringList(e.data)
  const logs = asStringList(e.logs)
  const expireText = (() => {
    if (!e.expiresTime) return null
    const remainMin = Math.max(0, Math.round((surgeTimestampToMs(e.expiresTime) - Date.now()) / 60000))
    return formatRequestDateTime(e.expiresTime) + `（剩余约 ${remainMin} 分钟）`
  })()

  return (
    <List navigationTitle={e.domain}>
      {/* 解析结果 */}
      <Section header={<Text>解析结果</Text>}>
        {records.length > 0 ? (
          records.map((ip, i) => (
            <HStack key={i}>
              <Text font={16}>{ip}</Text>
              <Spacer />
            </HStack>
          ))
        ) : (
          <Text font={13} foregroundStyle="secondaryLabel">无解析记录</Text>
        )}
      </Section>

      {/* 查询信息 */}
      <Section header={<Text>查询信息</Text>}>
        <InfoRow label="DNS 服务器" value={e.server ?? "系统默认"} />
        <InfoRow label="网络接口" value={e.interface || undefined} />
        <InfoRow
          label="查询耗时"
          value={e.timeCost != null ? `${Math.round(e.timeCost * 1000)} ms` : undefined}
        />
        <InfoRow label="过期时间" value={expireText} />
      </Section>

      {/* CNAME 链路 */}
      {e.path ? (
        <Section header={<Text>CNAME 解析链路</Text>}>
          <Text font={12}>{e.path}</Text>
        </Section>
      ) : null}

      {/* 查询日志 */}
      {logs.length > 0 ? (
        <Section header={<Text>查询日志</Text>}>
          {logs.map((log, i) => (
            <Text key={i} font={12} lineLimit={4}>{log}</Text>
          ))}
        </Section>
      ) : null}
    </List>
  )
}
