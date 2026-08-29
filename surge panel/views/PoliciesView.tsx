// 策略 Tab：策略组列表 + 节点钻取
import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  ProgressView,
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
  getPolicies,
  getPolicyBenchmarks,
  getPolicyDetail,
  getPolicyGroupSelection,
  getPolicyGroups,
  getGroupTestResults,
  getProxyGroupOrder,
  orderPolicyGroupNames,
  selectPolicyGroup,
  testPolicies,
  testPolicyGroup,
  type PolicyBenchmarkResult,
  type PolicyOption,
} from "../lib/surgeApi"
import { formatDelay, latencyForeground, pickBenchmark, resolvePolicyLatency, testResultScore, type LatencyStatus } from "../lib/metrics"
import { useStoreSelector } from "../lib/store"
import { useTabAutoRefresh } from "../lib/liveCache"
import { connectErrorText } from "../lib/ui"

function DelayLabel({
  status,
  ms,
  showNone = false,
}: {
  status: LatencyStatus
  ms?: number
  showNone?: boolean
}) {
  if (status === "testing") return <ProgressView />
  if (status === "fail") {
    return (
      <Text font={13} foregroundStyle="systemRed">
        失败
      </Text>
    )
  }
  if (status === "ms" && ms != null) {
    return (
      <Text font={13} foregroundStyle={latencyForeground(ms)}>
        {formatDelay(ms)}
      </Text>
    )
  }
  if (!showNone) return null
  return (
    <Text font={13} foregroundStyle="tertiaryLabel">
      未测速
    </Text>
  )
}

export function PoliciesView() {
  const config = useStoreSelector((s) => s.config)
  const [groups, setGroups] = useState<Record<string, PolicyOption[]> | null>(null)
  const [groupOrder, setGroupOrder] = useState<string[]>([])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [benchmarks, setBenchmarks] = useState<Record<string, PolicyBenchmarkResult> | null>(null)
  const [testResults, setTestResults] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")

  async function load(force = false) {
    setLoading(true)
    setError(null)
    try {
      const [g, bm, tr] = await Promise.all([
        getPolicyGroups(config),
        getPolicyBenchmarks(config).catch(() => ({}) as Record<string, PolicyBenchmarkResult>),
        getGroupTestResults(config).catch(() => ({}) as Record<string, unknown>),
      ])
      setGroups(g)
      setBenchmarks(bm ?? {})
      setTestResults(tr ?? {})
      const apiNames = Object.keys(g)
      try {
        // 组顺序解析自整份配置，已做内存缓存；下拉刷新时强制重取
        const order = await getProxyGroupOrder(config, force)
        setGroupOrder(orderPolicyGroupNames(apiNames, order))
      } catch {
        setGroupOrder(apiNames)
      }
      // 逐组查询当前选中项（url-test 等组可能不支持，忽略失败）
      const results = await Promise.all(
        apiNames.map(async (n) => {
          try {
            const r = await getPolicyGroupSelection(config, n)
            return [n, r.policy] as const
          } catch {
            return null
          }
        })
      )
      const sel: Record<string, string> = {}
      for (const r of results) if (r) sel[r[0]] = r[1]
      setSelections(sel)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useTabAutoRefresh(1, () => load())

  const names = groups ? (groupOrder.length ? groupOrder : Object.keys(groups)) : []
  const q = query.trim().toLowerCase()
  const filtered = q ? names.filter((n) => n.toLowerCase().includes(q)) : names

  return (
    <List
      navigationTitle={Script.env === "home_screen" ? undefined : "策略"}
      refreshable={async () => { await load(true) }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <Section>
        <TextField title="搜索" value={query} onChanged={setQuery} prompt="策略组名称" />
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{connectErrorText(error, "加载失败")}</Text>
          <Button title="重试" action={() => load(true)} />
        </Section>
      ) : null}
      {loading && !groups ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : null}
      {groups ? (
        <Section footer={<Text font={13}>{q ? `${filtered.length} / ${names.length} 个策略组` : `${names.length} 个策略组`}</Text>}>
          {filtered.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">{q ? "无匹配策略组" : "暂无策略组"}</Text>
          ) : (
            filtered.map((name) => {
            const options = groups[name]
            const selected = selections[name]
            const selectedOpt = selected ? options.find((o) => o.name === selected) : undefined
            const lat = resolvePolicyLatency({
              benchmark: pickBenchmark(benchmarks, selectedOpt ?? { name: selected ?? "" }),
              testScore: selected ? testResultScore(testResults, name, selected) : undefined,
            })
            return (
              <NavigationLink
                key={name}
                destination={
                  <GroupDetailView
                    groupName={name}
                    options={options}
                    initialSelection={selected ?? null}
                    initialBenchmarks={benchmarks}
                    initialTestResults={testResults}
                    onChanged={() => {
                      getPolicyGroupSelection(config, name)
                        .then((r) => setSelections((s) => ({ ...s, [name]: r.policy })))
                        .catch(() => {})
                    }}
                  />
                }
              >
                <HStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                    <Text font={17} lineLimit={1} minScaleFactor={0.8}>{name}</Text>
                    <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1} minScaleFactor={0.8}>
                      {selected ?? `${options.length} 个选项`}
                    </Text>
                  </VStack>
                  <Spacer />
                  <DelayLabel status={lat.status} ms={lat.ms} />
                </HStack>
              </NavigationLink>
            )
          })
          )}
        </Section>
      ) : null}
    </List>
  )
}

function NestedGroupLoader({ name }: { name: string }) {
  const config = useStoreSelector((s) => s.config)
  const [options, setOptions] = useState<PolicyOption[] | null>(null)
  const [selection, setSelection] = useState<string | null>(null)

  useEffect(() => {
    getPolicyGroups(config)
      .then((g) => setOptions(g[name] ?? []))
      .catch(() => setOptions([]))
    getPolicyGroupSelection(config, name)
      .then((r) => setSelection(r.policy))
      .catch(() => setSelection(null))
  }, [config, name])

  if (!options) {
    return (
      <List navigationTitle={name}>
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      </List>
    )
  }
  return (
    <GroupDetailView
      groupName={name}
      options={options}
      initialSelection={selection}
      onChanged={() => {
        getPolicyGroupSelection(config, name)
          .then((r) => setSelection(r.policy))
          .catch(() => {})
      }}
    />
  )
}

export function GroupDetailView({
  groupName,
  options,
  initialSelection,
  initialBenchmarks = null,
  initialTestResults = null,
  onChanged,
}: {
  groupName: string
  options: PolicyOption[]
  initialSelection: string | null
  initialBenchmarks?: Record<string, PolicyBenchmarkResult> | null
  initialTestResults?: Record<string, unknown> | null
  onChanged: () => void
}) {
  const config = useStoreSelector((s) => s.config)
  const [selection, setSelection] = useState<string | null>(initialSelection)
  const [standalone, setStandalone] = useState<Set<string> | null>(null)
  const [details, setDetails] = useState<Record<string, string>>({})
  const [delays, setDelays] = useState<Record<string, number | null>>({})
  const [elected, setElected] = useState<string[] | null>(null)
  // 是否为 url-test/fallback/load-balance 自动组（只有这类组的组测速是真基准测试）
  const [autoGroup, setAutoGroup] = useState<boolean | null>(null)
  // 自动组当前已当选节点（来自既有 test_results，未测速也可展示）
  const [autoElected, setAutoElected] = useState<string[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [testProgress, setTestProgress] = useState("")
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Surge 基准测试缓存（按 lineHash / 策略名），覆盖所有节点含内嵌/链式
  const [benchmarks, setBenchmarks] = useState<Record<
    string,
    PolicyBenchmarkResult
  > | null>(initialBenchmarks)
  const [groupTests, setGroupTests] = useState<Record<string, unknown> | null>(initialTestResults)

  function refreshBenchmarks() {
    return getPolicyBenchmarks(config)
      .then((r) => setBenchmarks(r ?? {}))
      .catch(() => setBenchmarks({}))
  }

  useEffect(() => {
    refreshBenchmarks()
  }, [config])

  // 独立策略（/v1/policies）才能单独测延迟；组内嵌节点 HTTP API 不支持延迟测试
  useEffect(() => {
    let cancelled = false
    getPolicies(config)
      .then((r) => {
        if (!cancelled) setStandalone(new Set(r.proxies))
      })
      .catch(() => {
        if (!cancelled) setStandalone(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [config])

  const isStandalone = (name: string) => standalone?.has(name) ?? false

  // test_results 只包含 url-test/fallback/load-balance 组——据此判断组类型
  useEffect(() => {
    let cancelled = false
    getGroupTestResults(config)
      .then((r) => {
        if (cancelled) return
        setGroupTests(r ?? {})
        const keys = Object.keys(r ?? {})
        setAutoGroup(keys.includes(groupName))
        const cur = r?.[groupName]
        if (Array.isArray(cur)) {
          setAutoElected(
            cur.map((v) => (typeof v === "string" ? v : v.policy))
          )
        }
      })
      .catch(() => {
        if (!cancelled) setAutoGroup(false)
      })
    return () => {
      cancelled = true
    }
  }, [config, groupName])

  // 独立策略拉取原始配置行展示
  useEffect(() => {
    if (!standalone) return
    let cancelled = false
    options
      .filter((o) => !o.isGroup && standalone.has(o.name))
      .forEach((o) => {
        getPolicyDetail(config, o.name)
          .then((r) => {
            const v = r?.[o.name]
            if (v && !cancelled) setDetails((d) => ({ ...d, [o.name]: v }))
          })
          .catch(() => {})
      })
    return () => {
      cancelled = true
    }
  }, [standalone, config])

  async function select(policy: string) {
    if (policy === selection || selecting) return
    setSelecting(policy)
    setError(null)
    try {
      await selectPolicyGroup(config, groupName, policy)
      setSelection(policy)
      onChanged()
    } catch (e) {
      setError(String(e))
    } finally {
      setSelecting(null)
    }
  }

  async function testAll() {
    if (testing) return
    setTesting(true)
    setError(null)
    setDelays({})
    setElected(null)

    // 1) 组测速：仅自动组（url-test 等）是真基准测试；select 手动组只会回显当前选中，跳过
    const groupTest = (async () => {
      if (autoGroup !== true) return
      try {
        setTestProgress("组测速中…")
        const r = await testPolicyGroup(config, groupName)
        setElected(r?.available ?? [])
      } catch {
        // 部分组类型不支持，忽略
      }
    })()

    // 2) 独立策略逐个测延迟（任一节点失败会导致整批响应为空，故逐个调用）
    const latencyTest = (async () => {
      const names = options
        .filter((o) => !o.isGroup && o.enabled && isStandalone(o.name))
        .map((o) => o.name)
      const result: Record<string, number | null> = {}
      let done = 0
      for (const n of names) {
        try {
          const r = await testPolicies(config, [n])
          const v = r ? r[n]?.["round-one-total"] : undefined
          result[n] = typeof v === "number" ? v : null
        } catch {
          result[n] = null
        }
        done++
        setTestProgress(`延迟测试 ${done}/${names.length}…`)
        setDelays({ ...result })
      }
    })()

    await Promise.all([groupTest, latencyTest])
    // 组测速完成后 Surge 会更新基准测试缓存，重新拉取以刷新所有节点的延迟显示
    await refreshBenchmarks()
    await getGroupTestResults(config)
      .then((r) => setGroupTests(r ?? {}))
      .catch(() => {})
    setTestProgress("")
    setTesting(false)
  }

  return (
    <List navigationTitle={groupName}>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : null}
      <Section
        footer={
          <Text font={13}>
            {testing
              ? testProgress || "测速中…"
              : autoGroup === false
              ? "点按节点即可切换。延迟来自 Surge 基准测试缓存（含内嵌/链式节点，由 Surge 后台定期自动更新）；手动选择组不支持面板内组测速"
              : "点按节点即可切换。延迟来自 Surge 基准测试缓存与组测速结果；「全部测速」会刷新本组。绿色「最优」为自动组当选节点"}
          </Text>
        }
      >
        <Button
          title={testing ? "测速中…" : "全部测速"}
          systemImage="speedometer"
          disabled={testing}
          action={testAll}
        />
      </Section>
      <Section>
        {options.map((o) => {
          const isSelected = o.name === selection
          const delay = delays[o.name]
          const electedList = elected ?? autoElected
          const isElected =
            autoGroup === true && (electedList?.includes(o.name) ?? false)
          const lat = resolvePolicyLatency({
            live: delay,
            benchmark: pickBenchmark(benchmarks, o),
            testScore: testResultScore(groupTests, groupName, o.name),
          })
          return (
            <HStack
              key={o.lineHash}
              spacing={10}
              onTapGesture={() => select(o.name)}
            >
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font={17} lineLimit={1} minScaleFactor={0.7}>{o.name}</Text>
                <Text font={13} foregroundStyle="secondaryLabel">{o.typeDescription}</Text>
                {details[o.name] ? (
                  <Text font={12} foregroundStyle="tertiaryLabel" lineLimit={1} minScaleFactor={0.7}>
                    {details[o.name]}
                  </Text>
                ) : null}
              </VStack>
              {selecting === o.name ? (
                <ProgressView />
              ) : (
                <VStack alignment="trailing" spacing={2}>
                  {isElected ? (
                    <Text font={12} foregroundStyle="systemGreen">最优</Text>
                  ) : null}
                  <DelayLabel status={lat.status} ms={lat.ms} showNone={!o.isGroup} />
                </VStack>
              )}
              {isSelected ? (
                <Image systemName="checkmark.circle.fill" foregroundStyle="systemBlue" font={18} />
              ) : null}
              {o.isGroup ? (
                <NavigationLink title="子组" destination={<NestedGroupLoader name={o.name} />} />
              ) : null}
            </HStack>
          )
        })}
      </Section>
    </List>
  )
}
