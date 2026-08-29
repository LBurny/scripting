// 设置 → 实例：添加 / 编辑 / 测试连通 / 删除
import {
  Button,
  List,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  useState,
} from "scripting"
import { InstanceList } from "../components/InstanceList"
import {
  defaultInstance,
  instanceToConfig,
  type SurgeInstance,
} from "../lib/instances"
import {
  addInstance,
  deleteInstance,
  switchInstance,
  updateInstance,
} from "../lib/store"
import { getEnvironment, probeOutbound } from "../lib/surgeApi"

export function InstancesView({ startAdding = false }: { startAdding?: boolean }) {
  const [editing, setEditing] = useState<SurgeInstance | null>(null)
  const [adding, setAdding] = useState(startAdding)

  if (adding) {
    return (
      <InstanceEditor
        initial={defaultInstance()}
        isNew
        onDone={() => setAdding(false)}
      />
    )
  }
  if (editing) {
    return (
      <InstanceEditor
        initial={editing}
        isNew={false}
        onDone={() => setEditing(null)}
      />
    )
  }
  return (
    <InstanceList
      onAdd={() => setAdding(true)}
      onEdit={(inst) => setEditing(inst)}
    />
  )
}

export function InstanceEditor({
  initial,
  isNew,
  onDone,
}: {
  initial: SurgeInstance
  isNew: boolean
  onDone?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [protocol, setProtocol] = useState<"http" | "https">(initial.protocol)
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(initial.port)
  const [key, setKey] = useState(initial.key)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function draft(): SurgeInstance {
    return {
      ...initial,
      name: name.trim() || host.trim() || "未命名",
      protocol,
      host: host.trim(),
      port: port.trim(),
      key,
    }
  }

  async function test() {
    setBusy(true)
    setMsg(null)
    try {
      const cfg = instanceToConfig(draft())
      const probe = await probeOutbound(cfg)
      let deviceName: string | undefined
      try {
        const env = await getEnvironment(cfg)
        deviceName = env.deviceName
      } catch {
        // environment 在部分设备不可用
      }
      const bits = [
        "连通正常",
        `${probe.latencyMs} ms`,
        probe.mode ? `出站 ${probe.mode}` : null,
        probe.version ? `v${probe.version}` : null,
        deviceName,
      ].filter(Boolean)
      setMsg(bits.join(" · "))
      if (!isNew) {
        updateInstance(initial.id, {
          deviceName,
          version: probe.version,
          build: probe.build,
        })
      }
    } catch (e) {
      setMsg(`失败：${e}`)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const inst = draft()
    if (isNew) {
      addInstance(inst)
      await switchInstance(inst.id)
    } else {
      updateInstance(inst.id, inst)
    }
    onDone?.()
  }

  async function remove() {
    try {
      await deleteInstance(initial.id)
      onDone?.()
    } catch (e) {
      setMsg(String(e))
    }
  }

  return (
    <List
      navigationTitle={isNew ? "添加实例" : "编辑实例"}
      confirmationDialog={{
        isPresented: confirmDelete,
        onChanged: setConfirmDelete,
        title: "删除此实例？",
        message: <Text>不会停止远端 Surge，只从面板里移除这条连接。</Text>,
        actions: <Button title="删除" role="destructive" action={() => { void remove() }} />,
      }}
    >
      <Section>
        <TextField label={<Text>名称</Text>} value={name} onChanged={setName} prompt="本机 / 网关" />
        <Picker title="协议" pickerStyle="segmented" value={protocol} onChanged={(v: string) => setProtocol(v as "http" | "https")}>
          <Text tag="http">http</Text>
          <Text tag="https">https</Text>
        </Picker>
        <TextField label={<Text>主机</Text>} value={host} onChanged={setHost} prompt="127.0.0.1" />
        <TextField label={<Text>端口</Text>} value={port} onChanged={setPort} prompt="6166" />
        <SecureField label={<Text>API Key</Text>} value={key} onChanged={setKey} prompt="X-Key" />
      </Section>
      <Section
        footer={
          <Text font={13}>
            {msg
              ? msg
              : protocol === "https"
                ? "HTTPS 使用 Surge MITM 自签证书，面板会跳过系统链校验。本机默认 http-api-tls = false，一般用 http。"
                : "用 GET /v1/outbound 测试连通。本机默认 http-api-tls = false。"}
          </Text>
        }
      >
        <Button title={busy ? "测试中…" : "测试连通"} systemImage="antenna.radiowaves.left.and.right" disabled={busy} action={() => { void test() }} />
        <Button title="保存" systemImage="checkmark.circle" action={() => { void save() }} />
      </Section>
      {!isNew ? (
        <Section>
          <Button title="删除实例" role="destructive" systemImage="trash" action={() => setConfirmDelete(true)} />
        </Section>
      ) : null}
      {onDone ? (
        <Section>
          <Button title="返回列表" action={onDone} />
        </Section>
      ) : null}
    </List>
  )
}
