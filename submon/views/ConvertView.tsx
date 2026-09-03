// views/ConvertView.tsx — 订阅转换主页：表单 + 生成结果 + 历史（全页唯一 List，Core 注入式渲染）
// 数据：lib/convert.ts（构造链接）+ lib/convertStore.ts（历史/自定义/lastForm）

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, TextField,
  Picker, Toggle, Link, useState, useEffect,
} from "scripting"
import {
  CONVERT_TARGETS, BUILTIN_BACKENDS, BUILTIN_CONFIGS, DEFAULT_PARAMS,
  normalizeUrlList, buildConvertUrl,
} from "../lib/convert"
import type { RemoteConfig } from "../lib/convert"
import {
  loadHistory, addHistory, clearHistory, loadCustom, loadLastForm, saveLastForm,
} from "../lib/convertStore"
import type { ConvertHistoryEntry } from "../lib/convertStore"
import { emitDataChanged, onDataChanged } from "../lib/bus"
import { fetchPreviewWithFallback } from "../lib/preview"
import type { PreviewResult } from "../lib/preview"
import { PreviewSheetCore } from "./ConvertPreviewSheet"

/** sheet 呈现对象（绝不传 undefined；收起态传 isPresented=false 的完整对象） */
export interface SheetProp {
  isPresented: boolean
  onChanged: (v: boolean) => void
  content: any
}
const CLOSED_SHEET: SheetProp = { isPresented: false, onChanged: () => {}, content: <VStack /> }

const ICON_W = 26

export interface ConvertForm {
  urlText: string
  target: string
  backend: string
  config: string
  showAdvanced: boolean
  params: typeof DEFAULT_PARAMS
}

export const DEFAULT_FORM: ConvertForm = {
  urlText: "",
  target: CONVERT_TARGETS[0].value,
  backend: BUILTIN_BACKENDS[0],
  config: "",
  showAdvanced: false,
  params: { ...DEFAULT_PARAMS },
}

/** 后端地址显示名（host） */
export function backendLabel(b: string): string {
  return b.replace(/^https?:\/\//i, "").split("/")[0] || b
}

/** target 值显示名 */
export function targetLabel(v: string): string {
  return CONVERT_TARGETS.find((t) => t.value === v)?.label ?? v
}

/** 高级布尔参数定义（渲染 Toggle 行用） */
const BOOL_PARAMS: { key: keyof typeof DEFAULT_PARAMS; label: string; icon: string; hint: string }[] = [
  { key: "emoji", label: "Emoji 国旗", icon: "face.smiling", hint: "节点名前加国旗 emoji" },
  { key: "udp", label: "UDP", icon: "network", hint: "启用 UDP 支持" },
  { key: "scv", label: "跳过证书验证", icon: "checkmark.shield", hint: "忽略节点 TLS 证书错误" },
  { key: "tfo", label: "TCP Fast Open", icon: "bolt", hint: "启用 TFO" },
  { key: "insert", label: "插入默认节点", icon: "plus.circle", hint: "结果头部插入 info 节点" },
  { key: "sort", label: "节点排序", icon: "arrow.up.arrow.down", hint: "对节点名排序" },
  { key: "fdn", label: "过滤非法节点", icon: "eye.slash", hint: "移除后端不支持的节点" },
  { key: "expand", label: "展开规则", icon: "chevron.up.chevron.down", hint: "展开远程配置的规则引用" },
]

/** 转换页核心渲染（form/回调注入，便于 mock 预览） */
export function ConvertCore({ form, onForm, backends, configs, history, result, message, messageIsError, copied, clearLabel, onGenerate, onCopy, onPickHistory, onClearHistory, onPreview, sheet }: {
  form: ConvertForm
  onForm: (patch: Partial<ConvertForm>) => void
  backends: string[]
  configs: RemoteConfig[]
  history: ConvertHistoryEntry[]
  result: string
  message: string
  messageIsError: boolean
  copied: boolean
  clearLabel: string
  onGenerate: () => void
  onCopy: () => void
  onPickHistory: (h: ConvertHistoryEntry) => void
  onClearHistory: () => void
  onPreview: () => void
  sheet: SheetProp
}) {
  const p = form.params
  const setParam = (patch: Partial<typeof DEFAULT_PARAMS>) => onForm({ params: { ...p, ...patch } })

  return (
    <List navigationTitle="转换" navigationBarTitleDisplayMode="inline" sheet={sheet}>
      <Section
        title="订阅链接（可多条，换行或 | 分隔）"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">原始机场订阅链接；粘贴多行会自动拆分。</Text>}
      >
        <TextField
          title="订阅链接"
          prompt="https://example.com/api/v1/client/subscribe?token=..."
          value={form.urlText}
          onChanged={(v: string) => onForm({ urlText: v })}
          autocapitalization="none"
          autocorrection={false}
        />
      </Section>

      <Section title="目标客户端">
        <Picker title="目标客户端" pickerStyle="menu" value={form.target} onChanged={(v: string) => onForm({ target: v })}>
          {CONVERT_TARGETS.map((t) => (
            <Text key={t.value} tag={t.value}>{t.label}</Text>
          ))}
        </Picker>
      </Section>

      <Section title="后端服务器">
        <Picker title="后端服务器" pickerStyle="menu" value={form.backend} onChanged={(v: string) => onForm({ backend: v })}>
          {backends.map((b) => (
            <Text key={b} tag={b}>{backendLabel(b)}</Text>
          ))}
        </Picker>
      </Section>

      <Section
        title="远程配置（规则）"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">「后端默认」不传 config 参数；自定义远程配置在设置页管理。</Text>}
      >
        <Picker title="远程配置" pickerStyle="menu" value={form.config} onChanged={(v: string) => onForm({ config: v })}>
          <Text tag="">后端默认规则</Text>
          {configs.map((c) => (
            <Text key={c.url} tag={c.url}>{c.label}</Text>
          ))}
        </Picker>
      </Section>

      <Section>
        <Button action={() => onForm({ showAdvanced: !form.showAdvanced })}>
          <HStack spacing={10}>
            <Image systemName="slider.horizontal.3" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemGreen">高级选项</Text>
            <Spacer />
            <Image systemName={form.showAdvanced ? "chevron.up" : "chevron.down"} foregroundStyle="tertiaryLabel" font={12} />
          </HStack>
        </Button>
      </Section>

      {form.showAdvanced ? (
        <Section
          title="转换参数"
          footer={<Text font={11} foregroundStyle="tertiaryLabel">include/exclude 支持正则，按节点名筛选或排除。</Text>}
        >
          {BOOL_PARAMS.map((b) => (
            <Toggle
              key={b.key}
              value={p[b.key] as boolean}
              onChanged={(v: boolean) => setParam({ [b.key]: v } as any)}
              tint={("systemGreen") as any}
            >
              <HStack spacing={10}>
                <Image systemName={b.icon} foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
                <Text font={15}>{b.label}</Text>
              </HStack>
            </Toggle>
          ))}
          <TextField
            title="include 筛选"
            prompt="如 香港|HK"
            value={p.include}
            onChanged={(v: string) => setParam({ include: v })}
            autocapitalization="none"
            autocorrection={false}
          />
          <TextField
            title="exclude 排除"
            prompt="如 过期|官网"
            value={p.exclude}
            onChanged={(v: string) => setParam({ exclude: v })}
            autocapitalization="none"
            autocorrection={false}
          />
        </Section>
      ) : null}

      <Section>
        <Button action={onGenerate}>
          <HStack spacing={10}>
            <Image systemName="wand.and.stars" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} fontWeight="semibold" foregroundStyle="systemGreen">生成转换链接</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button action={onPreview}>
          <HStack spacing={10}>
            <Image systemName="eye" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemGreen">预览订阅</Text>
            <Spacer />
            <Text font={11} foregroundStyle="tertiaryLabel">分组与节点</Text>
          </HStack>
        </Button>
      </Section>

      {message ? (
        <Section>
          <Text font={12} foregroundStyle={(messageIsError ? "systemRed" : "secondaryLabel") as any}>{message}</Text>
        </Section>
      ) : null}

      {result ? (
        <Section
          title="生成结果"
          footer={<Text font={11} foregroundStyle="tertiaryLabel">把此链接填入客户端的订阅地址即可；生成记录已自动存入历史。</Text>}
        >
          <VStack alignment="leading" spacing={8} padding={{ vertical: 4 }}>
            <Text font={11} monospacedDigit foregroundStyle="secondaryLabel" lineLimit={6}>{result}</Text>
            <HStack spacing={16}>
              <Button action={onCopy}>
                <Text font={13} foregroundStyle="systemGreen">{copied ? "已复制 ✓" : "复制链接"}</Text>
              </Button>
              <Link url={result}>
                <Text font={13} foregroundStyle="systemBlue">在 Safari 中打开</Text>
              </Link>
            </HStack>
          </VStack>
        </Section>
      ) : null}

      {history.length > 0 ? (
        <Section
          title="生成历史"
          footer={<Text font={11} foregroundStyle="tertiaryLabel">点按回填表单与结果；最多保留 30 条。</Text>}
        >
          {history.map((h) => (
            <Button key={h.id} action={() => onPickHistory(h)}>
              <HStack spacing={10}>
                <Image systemName="clock.arrow.circlepath" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
                <VStack alignment="leading" spacing={2}>
                  <Text font={14} lineLimit={1}>{targetLabel(h.target)}</Text>
                  <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>
                    {backendLabel(h.backend)} · {h.urls.length} 条链接
                  </Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font={11} />
              </HStack>
            </Button>
          ))}
          <Button action={onClearHistory}>
            <HStack spacing={10}>
              <Image systemName="trash" foregroundStyle="systemRed" frame={{ width: ICON_W }} font={14} />
              <Text font={15} foregroundStyle="systemRed">{clearLabel}</Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
      ) : null}
    </List>
  )
}

/** 实际转换页：状态装载 + 生成/历史交互 */
export function ConvertView() {
  const saved = loadLastForm()
  const [form, setForm] = useState<ConvertForm>(() => ({
    ...DEFAULT_FORM,
    ...saved,
    params: { ...DEFAULT_PARAMS, ...(saved.params ?? {}) },
  }))
  const [custom, setCustom] = useState(loadCustom)
  const [history, setHistory] = useState(loadHistory)
  const [result, setResult] = useState("")
  const [message, setMessage] = useState("")
  const [messageIsError, setMessageIsError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPhase, setPreviewPhase] = useState<"loading" | "error" | "done">("loading")
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [previewNotice, setPreviewNotice] = useState("")

  // lastForm 每次变更落盘（恢复上次输入）
  useEffect(() => {
    saveLastForm(form)
  }, [form])

  // 设置页改动自定义后端/配置、或历史变化时重新装载
  useEffect(() => {
    const off = onDataChanged(() => {
      setCustom(loadCustom())
      setHistory(loadHistory())
    })
    return off
  }, [])

  function onForm(patch: Partial<ConvertForm>) {
    setForm((f) => ({ ...f, ...patch }))
  }

  function onGenerate() {
    try {
      const urls = normalizeUrlList(form.urlText)
      const url = buildConvertUrl({
        backend: form.backend,
        target: form.target,
        urls,
        config: form.config,
        params: form.params,
      })
      setHistory(addHistory({
        url,
        backend: form.backend,
        target: form.target,
        config: form.config,
        urls,
      }))
      setResult(url)
      setMessageIsError(false)
      setMessage("已生成，共 " + urls.length + " 条订阅链接")
    } catch (e: any) {
      setResult("")
      setMessageIsError(true)
      setMessage(e?.message ?? String(e))
    }
  }

  async function onCopy() {
    if (!result) return
    await Pasteboard.setString(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function onPickHistory(h: ConvertHistoryEntry) {
    setForm((f) => ({
      ...f,
      urlText: h.urls.join("\n"),
      target: h.target,
      backend: h.backend,
      config: h.config,
    }))
    setResult(h.url)
    setMessageIsError(false)
    setMessage("已从历史回填")
  }

  function onClearHistory() {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    clearHistory()
    setHistory([])
    setMessageIsError(false)
    setMessage("已清空生成历史")
  }

  async function runPreview() {
    setPreviewPhase("loading")
    setPreviewError("")
    setPreviewNotice("")
    setPreviewResult(null)
    try {
      const urls = normalizeUrlList(form.urlText)
      const outcome = await fetchPreviewWithFallback({
        backend: form.backend,
        backends: dedupe([...BUILTIN_BACKENDS, ...custom.backends]),
        urls,
        config: form.config,
        params: form.params,
      })
      setPreviewResult(outcome.result)
      setPreviewNotice(
        outcome.usedBackend !== form.backend
          ? (outcome.selectedError
            ? "所选后端不可用，已自动切换到 " + backendLabel(outcome.usedBackend)
            : "所选后端响应较慢，已展示 " + backendLabel(outcome.usedBackend) + " 的结果")
          : "",
      )
      setPreviewPhase("done")
    } catch (e: any) {
      setPreviewError(e?.message ?? String(e))
      setPreviewPhase("error")
    }
  }

  function onPreview() {
    if (normalizeUrlList(form.urlText).length === 0) {
      setMessageIsError(true)
      setMessage("请先填写订阅链接再预览")
      return
    }
    setPreviewOpen(true)
    runPreview()
  }

  const backends = dedupe([...BUILTIN_BACKENDS, ...custom.backends])
  const configs: RemoteConfig[] = [
    ...BUILTIN_CONFIGS,
    ...custom.configs.map((u) => ({ label: u.replace(/^https?:\/\//i, ""), url: u })),
  ]

  return (
    <ConvertCore
      form={form}
      onForm={onForm}
      backends={backends}
      configs={configs}
      history={history}
      result={result}
      message={message}
      messageIsError={messageIsError}
      copied={copied}
      clearLabel={confirmClear ? "再点一次确认清空" : "清空生成历史"}
      onGenerate={onGenerate}
      onCopy={onCopy}
      onPickHistory={onPickHistory}
      onClearHistory={onClearHistory}
      onPreview={onPreview}
      sheet={{
        isPresented: previewOpen,
        onChanged: (v: boolean) => setPreviewOpen(v),
        content: (
          <PreviewSheetCore
            phase={previewPhase}
            result={previewResult}
            error={previewError}
            notice={previewNotice}
            onRetry={runPreview}
            onClose={() => setPreviewOpen(false)}
          />
        ),
      }}
    />
  )
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

// ---------- preview_ui mock（scripting-ts preview_ui 本文件用） ----------
export default function ConvertViewPreview() {
  const [form, setForm] = useState<ConvertForm>({
    ...DEFAULT_FORM,
    urlText: "https://a.example.com/sub?token=abc\nhttps://b.example.com/sub?token=def",
    showAdvanced: true,
  })
  const [result, setResult] = useState("")
  const [copied, setCopied] = useState(false)
  const MOCK_HISTORY: ConvertHistoryEntry[] = [
    { id: "h1", url: "https://api.dler.io/sub?target=clash&url=abc", backend: BUILTIN_BACKENDS[0], target: "clash", config: "", urls: ["https://a.example.com/sub?token=abc"], createdAt: Date.now() - 3600e3 },
    { id: "h2", url: "https://sub.xeton.dev/sub?target=surge&ver=4&url=def", backend: BUILTIN_BACKENDS[1], target: "surge&ver=4", config: BUILTIN_CONFIGS[0].url, urls: ["https://b.example.com/sub?token=def"], createdAt: Date.now() - 86e6 },
  ]
  return (
    <VStack
      spacing={0}
      frame={{ width: 390, height: 820 }}
      background={{ style: { light: "#f2f2f7", dark: "#0d1117" }, shape: "rect" }}
    >
      <ConvertCore
        form={form}
        onForm={(patch) => setForm((f) => ({ ...f, ...patch }))}
        backends={BUILTIN_BACKENDS}
        configs={BUILTIN_CONFIGS}
        history={MOCK_HISTORY}
        result={result}
        message=""
        messageIsError={false}
        copied={copied}
        clearLabel="清空生成历史"
        onGenerate={() => setResult("https://api.dler.io/sub?target=clash&url=https%3A%2F%2Fa.example.com%2Fsub%3Ftoken%3Dabc&emoji=true&udp=true")}
        onCopy={() => setCopied(true)}
        onPickHistory={() => {}}
        onClearHistory={() => {}}
        onPreview={() => {}}
        sheet={CLOSED_SHEET}
      />
    </VStack>
  )
}