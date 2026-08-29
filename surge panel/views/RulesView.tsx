// 规则浏览器：全量规则 + 搜索/类型/策略筛选
import {
  HStack,
  List,
  Picker,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  useEffect,
  useState,
  VStack,
  type Color,
} from "scripting"
import { getRules } from "../lib/surgeApi"
import { needsSetup, useStoreSelector } from "../lib/store"
import { connectErrorText } from "../lib/ui"
import { RequestsSegmentBar } from "../components/RequestsSegmentBar"

type ParsedRule = {
  raw: string
  type: string
  value: string
  policy: string
  module: string | null
}

function parseRule(raw: string): ParsedRule {
  let module: string | null = null
  let body = raw
  const idx = raw.indexOf("#!FROM-MODULE:")
  if (idx >= 0) {
    module = raw.slice(idx + "#!FROM-MODULE:".length).trim()
    body = raw.slice(0, idx).trim()
  }
  const parts = body.split(",")
  const type = parts[0] ?? ""
  const hasValue = parts.length >= 3
  return {
    raw,
    type,
    value: hasValue ? parts[1] : "",
    policy: hasValue ? parts[2] : (parts[1] ?? ""),
    module,
  }
}

const TYPE_COLORS: Record<string, Color> = {
  DOMAIN: "systemBlue",
  "DOMAIN-SUFFIX": "systemIndigo",
  "DOMAIN-KEYWORD": "systemPurple",
  "IP-CIDR": "systemTeal",
  "IP-CIDR6": "systemTeal",
  GEOIP: "systemOrange",
  "RULE-SET": "systemPink",
  FINAL: "systemGray",
}

export function RulesView() {
  const config = useStoreSelector((s) => s.config)
  const [rules, setRules] = useState<ParsedRule[] | null>(null)
  const [policies, setPolicies] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("__all__")
  const [policyFilter, setPolicyFilter] = useState("__all__")

  async function load() {
    if (needsSetup()) return
    try {
      const r = await getRules(config)
      setRules(r.rules.map(parseRule))
      setPolicies(r["available-policies"] ?? [])
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  // 规则只在配置重载时变化：进入分段拉一次即可，下拉可手动刷新，不随面板周期轮询
  useEffect(() => {
    void load()
  }, [config])

  const types = rules ? [...new Set(rules.map((r) => r.type))].sort() : []

  const filtered = (rules ?? []).filter((r) => {
    if (typeFilter !== "__all__" && r.type !== typeFilter) return false
    if (policyFilter !== "__all__" && r.policy !== policyFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        r.value.toLowerCase().includes(q) ||
        r.policy.toLowerCase().includes(q) ||
        (r.module?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  return (
    <List
      navigationTitle={Script.env === "home_screen" ? undefined : "规则"}
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

      {/* 筛选 */}
      <Section>
        <TextField title="搜索" value={search} onChanged={setSearch} prompt="域名 / 策略 / 模块" />
        <Picker title="类型" value={typeFilter} onChanged={setTypeFilter}>
          <Text tag="__all__">全部类型</Text>
          {types.map((t) => (
            <Text key={t} tag={t}>{t}</Text>
          ))}
        </Picker>
        <Picker title="策略" value={policyFilter} onChanged={setPolicyFilter}>
          <Text tag="__all__">全部策略</Text>
          {policies.map((p) => (
            <Text key={p} tag={p}>{p}</Text>
          ))}
        </Picker>
      </Section>

      {/* 规则列表 */}
      {rules === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : (
        <Section
          header={<Text>{`${filtered.length} / ${rules.length} 条规则`}</Text>}
          footer={<Text font={12}>规则按配置文件顺序匹配，越靠前优先级越高</Text>}
        >
          {filtered.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">无匹配规则</Text>
          ) : (
            filtered.map((r, i) => (
              <VStack key={`${i}-${r.raw}`} alignment="leading" spacing={2}>
                <HStack spacing={6}>
                  <Text font={10} foregroundStyle={TYPE_COLORS[r.type] ?? "secondaryLabel"}>
                    {r.type}
                  </Text>
                  <Spacer />
                  <Text font={11} foregroundStyle="secondaryLabel">{r.policy}</Text>
                </HStack>
                {r.value ? (
                  <Text font={13} lineLimit={1} minScaleFactor={0.6}>{r.value}</Text>
                ) : null}
                {r.module ? (
                  <Text font={10} foregroundStyle="tertiaryLabel" lineLimit={1}>
                    {`来自模块：${r.module}`}
                  </Text>
                ) : null}
              </VStack>
            ))
          )}
        </Section>
      )}
    </List>
  )
}
