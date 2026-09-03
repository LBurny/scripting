// views/SubEditSheet.tsx — 添加/编辑订阅 sheet（add 模式传 sub 缺省）

import {
  List, Section, VStack, HStack, Text, Button, Spacer, TextField, useState,
} from "scripting"
import { addSub, updateSub } from "../lib/subs"
import type { Sub } from "../lib/subs"
import { emitDataChanged } from "../lib/bus"

export function SubEditSheet({ sub, onClose }: { sub?: Sub; onClose: (message?: string) => void }) {
  const isEdit = !!sub
  const [name, setName] = useState(sub?.name ?? "")
  const [url, setUrl] = useState(sub?.url ?? "")
  const [ua, setUa] = useState(sub?.ua ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    if (isEdit) {
      updateSub(sub!.url, { name, ua })
      emitDataChanged()
      onClose(`已保存「${name.trim() || "我的订阅"}」`)
      return
    }
    const u = url.trim()
    if (!u) {
      setError("请输入订阅链接")
      return
    }
    setBusy(true)
    setError("")
    try {
      const created = await addSub(u, name, ua)
      emitDataChanged()
      onClose(`已添加「${created.name}」，返回列表下拉或点右上角刷新拉取流量`)
    } catch (e: any) {
      setError("添加失败：" + (e?.message ?? String(e)))
      setBusy(false)
    }
  }

  return (
    <VStack spacing={0}>
      <HStack padding={{ top: 16, leading: 16, bottom: 4, trailing: 16 }}>
        <Button title="取消" action={() => onClose()} />
        <Spacer />
        <Text font={16} fontWeight="semibold">{isEdit ? "编辑订阅" : "添加订阅"}</Text>
        <Spacer />
        <Button title={busy ? "添加中…" : "保存"} fontWeight="semibold" action={submit} />
      </HStack>
      <List>
        {isEdit ? (
          <Section title="链接（不可修改）">
            <VStack alignment="leading" spacing={2} padding={{ vertical: 2 }}>
              <Text font={13} foregroundStyle="secondaryLabel" lineLimit={2}>{sub!.url}</Text>
            </VStack>
          </Section>
        ) : (
          <Section footer={<Text font={12} foregroundStyle="tertiaryLabel">机场订阅链接，省略 https:// 会自动补全</Text>}>
            <TextField
              title="订阅链接"
              prompt="https://example.com/api/v1/client/subscribe?token=..."
              value={url}
              onChanged={(v: string) => { setUrl(v); setError("") }}
              autofocus
            />
          </Section>
        )}
        <Section>
          <TextField
            title="名称"
            prompt={isEdit ? sub!.name : "我的订阅"}
            value={name}
            onChanged={(v: string) => { setName(v); setError("") }}
          />
        </Section>
        <Section
          title="自定义 User-Agent（选填）"
          footer={<Text font={12} foregroundStyle="tertiaryLabel">部分机场只对特定 UA 返回流量信息；留空默认 clash.meta（兼容性最好），不行再试 clash / surge / shadowrocket。</Text>}
        >
          <TextField
            title="User-Agent"
            prompt="clash"
            value={ua}
            onChanged={(v: string) => { setUa(v); setError("") }}
            autocapitalization="none"
            autocorrection={false}
          />
        </Section>
        {error ? (
          <Text font={13} foregroundStyle="systemRed">{error}</Text>
        ) : null}
      </List>
    </VStack>
  )
}