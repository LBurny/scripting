// 脚本管理：列出 Surge 配置的脚本，cron 脚本可手动触发
import {
  Button,
  HStack,
  List,
  NavigationLink,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  useEffect,
  useState,
  VStack,
} from "scripting"
import { evaluateScript, getScripts, runCronScript, type SurgeScript } from "../lib/surgeApi"
import { useStoreSelector } from "../lib/store"

const TYPE_LABELS: Record<string, string> = {
  cron: "定时",
  generic: "通用",
  "http-request": "HTTP 请求",
  "http-response": "HTTP 响应",
  rule: "规则",
  dns: "DNS",
  event: "事件",
  tile: "卡片",
}

function shortPath(p: string): string {
  if (p.length <= 50) return p
  try {
    const u = new URL(p)
    const segs = u.pathname.split("/").filter(Boolean)
    return `${u.host}/…/${segs[segs.length - 1] ?? ""}`
  } catch {
    return `…${p.slice(-45)}`
  }
}

export function ScriptsView() {
  const config = useStoreSelector((s) => s.config)
  const [scripts, setScripts] = useState<SurgeScript[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  useEffect(() => {
    getScripts(config)
      .then((r) => setScripts(r.scripts))
      .catch((e) => setError(String(e)))
  }, [config])

  async function runCron(name: string) {
    if (running) return
    setRunning(name)
    try {
      await runCronScript(config, name)
      setResults((m) => ({ ...m, [name]: "✓ 已触发执行" }))
    } catch (e) {
      setResults((m) => ({ ...m, [name]: `✗ ${String(e)}` }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <List navigationTitle="脚本">
      <Section>
        <NavigationLink title="调试执行" destination={<ScriptEvaluateView />} />
      </Section>
      {error ? (
        <Section>
          <Text foregroundStyle="systemRed">{error}</Text>
        </Section>
      ) : null}
      {scripts === null ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        </Section>
      ) : scripts.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">未配置任何脚本</Text>
        </Section>
      ) : (
        <Section
          header={<Text>{`${scripts.length} 个脚本`}</Text>}
          footer={<Text font={12}>定时脚本可手动触发。开关需在 Surge 配置中修改。</Text>}
        >
          {scripts.map((s) => (
            <VStack key={s.name} alignment="leading" spacing={3}>
              <HStack spacing={8}>
                <Text font={15}>{s.name}</Text>
                <Text font={10} foregroundStyle={s.enabled ? "systemGreen" : "secondaryLabel"}>
                  {s.enabled ? "已启用" : "已停用"}
                </Text>
                <Spacer />
                <Text font={11} foregroundStyle="secondaryLabel">
                  {TYPE_LABELS[s.type] ?? s.type}
                </Text>
              </HStack>
              <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1} minScaleFactor={0.7}>
                {shortPath(s.path)}
              </Text>
              {s.type === "cron" && s.enabled ? (
                <HStack spacing={8}>
                  <Button
                    title={running === s.name ? "执行中…" : "立即执行"}
                    systemImage="play.circle"
                    disabled={running !== null}
                    action={() => runCron(s.name)}
                  />
                  {results[s.name] ? (
                    <Text
                      font={11}
                      foregroundStyle={results[s.name].startsWith("✓") ? "systemGreen" : "systemRed"}
                      lineLimit={1}
                    >
                      {results[s.name]}
                    </Text>
                  ) : null}
                </HStack>
              ) : null}
            </VStack>
          ))}
        </Section>
      )}
    </List>
  )
}

function ScriptEvaluateView() {
  const config = useStoreSelector((s) => s.config)
  const [code, setCode] = useState('console.log("hello from Surge Panel")')
  const [mockType, setMockType] = useState("cron")
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await evaluateScript(config, code, mockType, 5)
      setResult(typeof r === "string" ? r : JSON.stringify(r, null, 2) || "执行完成（无返回）")
    } catch (e) {
      setResult(`失败：${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <List navigationTitle="调试执行">
      <Section footer={<Text font={13}>POST /v1/scripting/evaluate。$trigger 为 http-api。</Text>}>
        <Picker title="类型" value={mockType} onChanged={setMockType}>
          <Text tag="cron">cron</Text>
          <Text tag="http-request">http-request</Text>
          <Text tag="http-response">http-response</Text>
          <Text tag="generic">generic</Text>
          <Text tag="event">event</Text>
          <Text tag="dns">dns</Text>
        </Picker>
        <TextField
          title="脚本"
          value={code}
          onChanged={setCode}
          prompt="script_text"
        />
        <Button title={busy ? "执行中…" : "执行"} systemImage="play.circle" disabled={busy} action={() => { void run() }} />
      </Section>
      {result ? (
        <Section header={<Text>结果</Text>}>
          <Text font={13} multilineTextAlignment="leading">{result}</Text>
        </Section>
      ) : null}
    </List>
  )
}
