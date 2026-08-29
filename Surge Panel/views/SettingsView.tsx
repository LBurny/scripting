// 设置 Tab：连接、面板、引擎、脚本、配置
import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationLink,
  Picker,
  Script,
  Section,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useState,
  VStack,
} from "scripting"
import {
  evaluateScript,
  formatProfileValue,
  getCurrentProfile,
  getFeature,
  getModules,
  getOutboundGlobal,
  getOutboundMode,
  getRules,
  parseProfileSections,
  reloadProfile,
  setFeature,
  setLogLevel as setSurgeLogLevel,
  setModule,
  setOutboundGlobal,
  setOutboundMode,
  stopEngine,
  FEATURE_LABELS,
  type FeatureKey,
  type ProfileLine,
  type ProfileSection,
} from "../lib/surgeApi"
import { displayHostPort, displayPrimaryAddrs, parsePrimaryAddresses } from "../lib/metrics"
import { ChangelogView } from "../components/ReleaseNotesSheet"
import { clearHistory, needsSetup, savePrefs, useStoreSelector } from "../lib/store"
import { ScriptsView } from "./ScriptsView"
import { InstancesView } from "./InstancesView"

const ENGINE_FEATURE_LABELS: Record<FeatureKey, string> = {
  mitm: "MitM",
  capture: "捕获 HTTP 请求",
  rewrite: "重写",
  scripting: "脚本",
}

/** 「历史长度」的时长说明按当前刷新间隔换算 */
function historyLenLabel(points: number, intervalSec: number): string {
  const min = Math.round((points * intervalSec) / 60)
  if (min >= 60) {
    const h = min / 60
    return Number.isInteger(h) ? `约 ${h} 小时` : `约 ${h.toFixed(1)} 小时`
  }
  return `约 ${min} 分钟`
}

export function SettingsView() {
  // 只订阅需要的切片：speedHistory 每秒变化，不该带着整个设置页重渲染
  const { config, prefs, instances, activeId } = useStoreSelector((s) => ({
    config: s.config,
    prefs: s.prefs,
    instances: s.instances,
    activeId: s.activeId,
  }))
  const dismiss = Navigation.useDismiss()

  // 引擎状态
  const [outbound, setOutbound] = useState<string | null>(null)
  const [globalPolicy, setGlobalPolicy] = useState<string | null>(null)
  const [policyChoices, setPolicyChoices] = useState<string[]>([])
  const [features, setFeatures] = useState<Record<FeatureKey, boolean> | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  // 确认弹窗
  const [confirm, setConfirm] = useState<null | "reload" | "stop" | "clearHistory">(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  // 日志级别（API 无读取端点，仅展示默认；修改立即生效）
  const [logLevel, setLogLevel] = useState("notify")
  const [localAddrs, setLocalAddrs] = useState<{ ipv4?: string; ipv6?: string }>({})

  async function loadEngineState() {
    if (needsSetup()) {
      setOutbound(null)
      setGlobalPolicy(null)
      setPolicyChoices([])
      setFeatures(null)
      setEngineError(null)
      setLocalAddrs({})
      return
    }
    evaluateScript(config, "$done($network)", "generic", 3)
      .then((raw) => {
        setLocalAddrs(parsePrimaryAddresses(raw))
      })
      .catch(() => {
        setLocalAddrs({})
      })
    try {
      const [ob, f] = await Promise.all([
        getOutboundMode(config),
        Promise.all(
          (Object.keys(FEATURE_LABELS) as FeatureKey[]).map(async (k) => {
            const r = await getFeature(config, k)
            return [k, r.enabled] as const
          })
        ),
      ])
      setOutbound(ob.mode)
      setFeatures(Object.fromEntries(f) as Record<FeatureKey, boolean>)
      setEngineError(null)
      // 全局模式下的默认策略与可选策略列表
      if (ob.mode === "proxy") {
        getOutboundGlobal(config)
          .then((r) => setGlobalPolicy(r.policy))
          .catch(() => {})
        getRules(config)
          .then((r) => setPolicyChoices(r["available-policies"] ?? []))
          .catch(() => {})
      }
    } catch (e) {
      setEngineError(String(e))
    }
  }

  useEffect(() => {
    loadEngineState()
  }, [config])

  async function changeOutbound(mode: string) {
    setOutbound(mode)
    try {
      await setOutboundMode(config, mode)
      if (mode === "proxy") {
        getOutboundGlobal(config).then((r) => setGlobalPolicy(r.policy)).catch(() => {})
        getRules(config).then((r) => setPolicyChoices(r["available-policies"] ?? [])).catch(() => {})
      }
    } catch (e) {
      setEngineError(String(e))
    }
  }

  async function changeGlobalPolicy(policy: string) {
    setGlobalPolicy(policy)
    try {
      await setOutboundGlobal(config, policy)
    } catch (e) {
      setEngineError(String(e))
    }
  }

  async function changeLogLevel(level: string) {
    try {
      await setSurgeLogLevel(config, level)
      setActionMsg(`日志级别已切换为 ${level}（仅当前会话有效）`)
    } catch (e) {
      setEngineError(String(e))
    }
  }

  async function toggleFeature(k: FeatureKey, v: boolean) {
    setFeatures((f) => (f ? { ...f, [k]: v } : f))
    try {
      await setFeature(config, k, v)
    } catch (e) {
      setEngineError(String(e))
      loadEngineState()
    }
  }

  async function runConfirmed() {
    const what = confirm
    setConfirm(null)
    try {
      if (what === "reload") {
        await reloadProfile(config)
        setActionMsg("配置已重新加载")
      } else if (what === "stop") {
        await stopEngine(config)
        setActionMsg("引擎已停止，请在 Surge 中重新启动")
      } else if (what === "clearHistory") {
        clearHistory()
        setActionMsg("采样历史已清空")
      }
    } catch (e) {
      setActionMsg(`操作失败：${e}`)
    }
  }

  const instanceAddrNote = displayPrimaryAddrs(localAddrs, prefs.hideAddresses)

  return (
    <List
      navigationTitle={Script.env === "home_screen" ? undefined : "设置"}
      confirmationDialog={{
        isPresented: confirm !== null,
        onChanged: (v: boolean) => {
          if (!v) setConfirm(null)
        },
        title:
          confirm === "reload"
            ? "重新加载配置？"
            : confirm === "stop"
              ? "停止 Surge 引擎？"
              : "清空采样历史？",
        message:
          confirm === "stop" ? (
            <Text>停止后需在 Surge 应用中手动重新启动引擎</Text>
          ) : undefined,
        actions: (
          <Button
            title={confirm === "stop" ? "停止引擎" : "确认"}
            role="destructive"
            action={runConfirmed}
          />
        ),
      }}
    >
      {/* 实例 */}
      <Section header={<Text>实例</Text>} footer={<Text font={13}>{needsSetup() ? "还没有可连接的实例。先添加本机或网关 HTTP API 并填写 Key。" : `可添加本机与网关等多个 Surge HTTP API，点按切换。当前：${instances.find((i) => i.id === activeId)?.name ?? "—"}（${displayHostPort(config.host, config.port, prefs.hideAddresses)}）${instanceAddrNote ? ` · ${instanceAddrNote}` : ""}`}</Text>}>
        <NavigationLink title="管理实例" destination={<InstancesView />} />
      </Section>

      {/* 面板 */}
      <Section
        header={<Text>面板</Text>}
        footer={<Text font={13}>刷新间隔用于内存趋势与引擎指标。实时速率图固定 1 秒采样（/v1/traffic），与 Surge Web Dashboard 一致。总览点按地址也可隐藏本机 IP，方便截图。</Text>}
      >
        <NavigationLink title="更新说明" destination={<ChangelogView />} />
        <Toggle
          title="自动刷新"
          value={prefs.autoRefresh}
          onChanged={(v: boolean) => savePrefs({ ...prefs, autoRefresh: v })}
        />
        <Picker
          title="刷新间隔"
          value={String(prefs.intervalSec)}
          onChanged={(v: string) => savePrefs({ ...prefs, intervalSec: Number(v) as 3 | 5 | 10 })}
        >
          <Text tag="3">3 秒</Text>
          <Text tag="5">5 秒</Text>
          <Text tag="10">10 秒</Text>
        </Picker>
        <Picker
          title="历史长度"
          value={String(prefs.maxPoints)}
          onChanged={(v: string) => savePrefs({ ...prefs, maxPoints: Number(v) as 180 | 360 | 720 })}
        >
          <Text tag="180">{`180 点（${historyLenLabel(180, prefs.intervalSec)}）`}</Text>
          <Text tag="360">{`360 点（${historyLenLabel(360, prefs.intervalSec)}）`}</Text>
          <Text tag="720">{`720 点（${historyLenLabel(720, prefs.intervalSec)}）`}</Text>
        </Picker>
        <Toggle
          title="隐藏总览地址"
          value={prefs.hideAddresses}
          onChanged={(v: boolean) => savePrefs({ ...prefs, hideAddresses: v })}
        />
        <Button title="清空采样历史" role="destructive" systemImage="trash" action={() => setConfirm("clearHistory")} />
      </Section>

      {/* 引擎：出站、功能开关、模块、日志 */}
      <Section
        header={<Text>引擎</Text>}
        footer={
          engineError ? (
            <Text font={13} foregroundStyle="systemRed">{engineError}</Text>
          ) : (
            <Text font={13}>模块在子页开关，可用系统搜索栏筛选。</Text>
          )
        }
      >
        {outbound === null ? (
          <Text foregroundStyle="secondaryLabel">{engineError ? "出站模式不可用" : "加载出站模式…"}</Text>
        ) : (
          <Picker title="出站模式" pickerStyle="segmented" value={outbound} onChanged={changeOutbound}>
            <Text tag="rule">规则</Text>
            <Text tag="proxy">代理</Text>
            <Text tag="direct">直连</Text>
          </Picker>
        )}
        {outbound === "proxy" && globalPolicy !== null ? (
          <Picker title="全局策略" value={globalPolicy} onChanged={changeGlobalPolicy}>
            {policyChoices.map((p) => (
              <Text key={p} tag={p}>{p}</Text>
            ))}
          </Picker>
        ) : null}
        <Picker title="日志级别" value={logLevel} onChanged={changeLogLevel}>
          <Text tag="verbose">verbose（最详细）</Text>
          <Text tag="info">info</Text>
          <Text tag="notify">notify</Text>
          <Text tag="warning">warning</Text>
          <Text tag="error">error（最少）</Text>
        </Picker>
        {features === null ? (
          <Text foregroundStyle="secondaryLabel">{engineError ? "功能开关不可用" : "加载功能开关…"}</Text>
        ) : (
          (Object.keys(ENGINE_FEATURE_LABELS) as FeatureKey[]).map((k) => (
            <Toggle key={k} title={ENGINE_FEATURE_LABELS[k]} value={features[k]} onChanged={(v: boolean) => toggleFeature(k, v)} />
          ))
        )}
        {needsSetup() ? null : <NavigationLink title="模块" destination={<ModulesView />} />}
      </Section>

      {/* 脚本 */}
      <Section header={<Text>脚本</Text>}>
        <NavigationLink title="脚本管理" destination={<ScriptsView />} />
      </Section>

      {/* 配置 */}
      <Section header={<Text>配置</Text>} footer={actionMsg ? <Text font={13}>{actionMsg}</Text> : undefined}>
        <NavigationLink title="查看当前配置" destination={<ProfileView />} />
        <Button title="重新加载配置" systemImage="arrow.triangle.2.circlepath" action={() => setConfirm("reload")} />
        <Button title="停止引擎" role="destructive" systemImage="stop.circle" action={() => setConfirm("stop")} />
      </Section>

      {/* 退出（首页 Tab 环境无页面可退，隐藏） */}
      {Script.env === "home_screen" ? null : (
        <Section>
          <Button title="退出脚本" systemImage="xmark.rectangle" action={() => dismiss()} />
        </Section>
      )}
    </List>
  )
}

// ---------- 模块（子页，避免把设置引擎区拉得很长） ----------

function ModulesView() {
  const config = useStoreSelector((s) => s.config)
  const [modules, setModules] = useState<{ available: string[]; enabled: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  async function load() {
    if (needsSetup()) {
      setModules(null)
      setError(null)
      return
    }
    try {
      setModules(await getModules(config))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [config])

  async function toggleModule(name: string, v: boolean) {
    setModules((m) =>
      m
        ? {
            available: m.available,
            enabled: v ? [...m.enabled, name] : m.enabled.filter((x) => x !== name),
          }
        : m
    )
    try {
      await setModule(config, name, v)
    } catch (e) {
      setError(String(e))
      void load()
    }
  }

  const q = query.trim().toLowerCase()
  const available = modules?.available ?? []
  const enabled = modules?.enabled ?? []
  const shown = q ? available.filter((name) => name.toLowerCase().includes(q)) : available

  return (
    <List
      navigationTitle="模块"
      refreshable={async () => { await load() }}
      searchable={{
        value: query,
        onChanged: setQuery,
        prompt: "模块名",
        placement: "navigationBarDrawer",
      }}
    >
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : null}
      <Section
        header={<Text>{modules ? `已启用 ${enabled.length} / ${available.length}` : "模块"}</Text>}
        footer={<Text font={13}>下拉可刷新。开关立即写入当前 Surge 实例。</Text>}
      >
        {modules === null && !error ? (
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        ) : shown.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">{q ? "无匹配模块" : "无可用模块"}</Text>
        ) : (
          shown.map((name) => (
            <Toggle
              key={name}
              title={name}
              value={enabled.includes(name)}
              onChanged={(v: boolean) => toggleModule(name, v)}
            />
          ))
        )}
      </Section>
    </List>
  )
}

// ---------- 查看当前配置：分段索引 + 子页，避免一次渲染整份配置 ----------

function isCommentLine(text: string): boolean {
  return text.startsWith("#") || text.startsWith(";") || text.startsWith("//")
}

function profileLineMatches(line: ProfileLine, q: string): boolean {
  if (!q) return true
  if (line.kind === "kv") {
    return line.key.toLowerCase().includes(q) || line.value.toLowerCase().includes(q)
  }
  return line.text.toLowerCase().includes(q)
}

function profileSectionMatches(sec: ProfileSection, q: string): boolean {
  if (!q) return true
  if (sec.name.toLowerCase().includes(q)) return true
  return sec.lines.some((line) => profileLineMatches(line, q))
}

function ProfileLineRow({ line }: { line: ProfileLine }) {
  if (line.kind === "kv") {
    return (
      <VStack alignment="leading" spacing={4} padding={{ vertical: 4 }}>
        <Text font={13} fontWeight="medium" foregroundStyle="secondaryLabel">
          {line.key}
        </Text>
        <Text
          font={15}
          multilineTextAlignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {formatProfileValue(line.value)}
        </Text>
      </VStack>
    )
  }
  return (
    <Text
      font={14}
      foregroundStyle={isCommentLine(line.text) ? "secondaryLabel" : "label"}
      multilineTextAlignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {line.text}
    </Text>
  )
}

function ProfileSectionView({
  section,
  initialQuery = "",
}: {
  section: ProfileSection
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const q = query.trim().toLowerCase()
  const shown = q ? section.lines.filter((line) => profileLineMatches(line, q)) : section.lines
  const title = section.name || "未命名"

  return (
    <List
      navigationTitle={title}
      searchable={{
        value: query,
        onChanged: setQuery,
        prompt: "键 / 值",
        placement: "navigationBarDrawer",
      }}
    >
      <Section header={<Text>{q ? `${shown.length} / ${section.lines.length} 行` : `${section.lines.length} 行`}</Text>}>
        {shown.length === 0 ? (
          <Text foregroundStyle="secondaryLabel">无匹配行</Text>
        ) : (
          shown.map((line, li) => <ProfileLineRow key={li} line={line} />)
        )}
      </Section>
    </List>
  )
}

function ProfileView() {
  const config = useStoreSelector((s) => s.config)
  const [profile, setProfile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sensitive, setSensitive] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    setProfile(null)
    getCurrentProfile(config, sensitive)
      .then((r) => setProfile(typeof r === "string" ? r : r.profile ?? ""))
      .catch((e) => setError(String(e)))
  }, [config, sensitive])

  const sections = profile ? parseProfileSections(profile) : []
  const q = query.trim().toLowerCase()
  const shown = q ? sections.filter((sec) => profileSectionMatches(sec, q)) : sections

  return (
    <List
      navigationTitle="当前配置"
      tabBarVisibility="visible"
      searchable={{
        value: query,
        onChanged: setQuery,
        prompt: "分段 / 键 / 值",
        placement: "navigationBarDrawer",
      }}
    >
      <Section footer={<Text font={13}>显示敏感字段会再次向 Surge 拉取配置（含密码）。点按分段进入详情，避免一次画出整份配置。</Text>}>
        <Toggle title="显示敏感字段" value={sensitive} onChanged={setSensitive} />
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : profile === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : sections.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">配置为空</Text>
        </Section>
      ) : (
        <Section header={<Text>{q ? `${shown.length} / ${sections.length} 个分段` : `${sections.length} 个分段`}</Text>}>
          {shown.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">无匹配分段</Text>
          ) : (
            shown.map((sec, si) => (
              <NavigationLink key={`${sec.name}-${si}`} destination={<ProfileSectionView section={sec} initialQuery={q} />}>
                <HStack>
                  <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>{sec.name || "未命名"}</Text>
                  <Spacer />
                  <Text font={13} foregroundStyle="secondaryLabel">{`${sec.lines.length} 行`}</Text>
                </HStack>
              </NavigationLink>
            ))
          )}
        </Section>
      )}
    </List>
  )
}
