// views/ConvertManageSheet.tsx — 管理自定义后端 / 远程配置（转换页 Picker 数据源）
// kind = "backend"：添加时 normalizeBackend 规范化；kind = "config"：校验 http(s):// 前缀

import {
  List, Section, VStack, HStack, Text, Button, Spacer, TextField, useState,
} from "scripting"
import { loadCustom, saveCustom } from "../lib/convertStore"
import { normalizeBackend } from "../lib/convert"
import { emitDataChanged } from "../lib/bus"

export function ConvertManageSheet({ kind, onClose }: {
  kind: "backend" | "config"
  onClose: (message?: string) => void
}) {
  const isBackend = kind === "backend"
  const [text, setText] = useState("")
  const [items, setItems] = useState<string[]>(() => (isBackend ? loadCustom().backends : loadCustom().configs))
  const [error, setError] = useState("")

  function persist(next: string[]) {
    const custom = loadCustom()
    saveCustom(isBackend ? { ...custom, backends: next } : { ...custom, configs: next })
    setItems(next)
    emitDataChanged() // 转换页监听刷新
  }

  function addItem() {
    const raw = text.trim()
    if (!raw) {
      setError("请输入地址")
      return
    }
    let value = raw
    if (isBackend) {
      value = normalizeBackend(raw)
    } else {
      if (!/^https?:\/\//i.test(value)) value = "https://" + value
    }
    if (items.indexOf(value) >= 0) {
      setError("该条目已存在")
      return
    }
    const next = [...items, value]
    persist(next)
    setText("")
    setError("")
  }

  function removeItem(v: string) {
    persist(items.filter((x) => x !== v))
  }

  return (
    <VStack spacing={0}>
      <HStack padding={{ top: 16, leading: 16, bottom: 4, trailing: 16 }}>
        <Button title="完成" action={() => onClose()} />
        <Spacer />
        <Text font={16} fontWeight="semibold">{isBackend ? "自定义后端" : "自定义远程配置"}</Text>
        <Spacer />
        <Button title="清空" action={() => { persist([]); }} />
      </HStack>
      <List>
        <Section
          footer={isBackend
            ? <Text font={11} foregroundStyle="tertiaryLabel">自建或第三方 subconverter 后端地址，如 https://my.domain.io；会自动规范化为 …/sub? 形式。内置后端在转换页下拉里始终可选。</Text>
            : <Text font={11} foregroundStyle="tertiaryLabel">远程配置为 .ini 规则文件 URL（如自托管的 ACL4SSR 变体）。内置 ACL4SSR 预设不受影响，始终可用。</Text>}
        >
          <TextField
            title={isBackend ? "后端地址" : "配置文件 URL"}
            prompt={isBackend ? "https://my.domain.io" : "https://my.domain.io/rules.ini"}
            value={text}
            onChanged={(v: string) => { setText(v); setError("") }}
            autocapitalization="none"
            autocorrection={false}
          />
          <Button action={addItem}>
            <HStack spacing={10}>
              <Spacer />
              <Text font={15} fontWeight="semibold" foregroundStyle="systemGreen">添加</Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>

        {error ? (
          <Section>
            <Text font={13} foregroundStyle="systemRed">{error}</Text>
          </Section>
        ) : null}

        <Section title={`已添加 ${items.length} 条`}>
          {items.length === 0 ? (
            <VStack alignment="leading" spacing={2} padding={{ vertical: 4 }}>
              <Text font={13} foregroundStyle="secondaryLabel">还没有自定义条目。</Text>
            </VStack>
          ) : items.map((v) => (
            <HStack key={v} spacing={10}>
              <Text font={12} monospacedDigit lineLimit={2}>{v}</Text>
              <Spacer />
              <Button action={() => removeItem(v)}>
                <Image systemName="minus.circle.fill" foregroundStyle={("systemRed") as any} font={18} />
              </Button>
            </HStack>
          ))}
        </Section>
      </List>
    </VStack>
  )
}