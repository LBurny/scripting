// views/SettingsView.tsx — 设置：小组件刷新说明 / 数据管理 / 关于（仿 reader SettingsView 风格）

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, Link,
  useState,
} from "scripting"
import { Widget } from "scripting"
import { saveStates } from "../lib/store"
import { emitDataChanged } from "../lib/bus"
import { ConvertManageSheet } from "./ConvertManageSheet"
import { loadCustom } from "../lib/convertStore"

const ICON_W = 26

export function SettingsView() {
  const [confirmClear, setConfirmClear] = useState(false)
  const [message, setMessage] = useState("")
  const [manageKind, setManageKind] = useState<"backend" | "config" | null>(null)
  const [customCount, setCustomCount] = useState(() => {
    const c = loadCustom()
    return c.backends.length + c.configs.length
  })

  function reloadCustomCount() {
    const c = loadCustom()
    setCustomCount(c.backends.length + c.configs.length)
  }
  function customBackendCountLabel(): string {
    const c = loadCustom()
    return c.backends.length > 0 ? `${c.backends.length} 条` : "内置 5 个"
  }
  function customConfigCountLabel(): string {
    const c = loadCustom()
    return c.configs.length > 0 ? `${c.configs.length} 条` : "内置 8 组"
  }

  function reloadWidget() {
    Widget.reloadAll()
    setMessage("已请求重载桌面小组件")
  }

  function clearCache() {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    saveStates({})
    emitDataChanged()
    setMessage("已清除流量缓存（订阅配置保留）")
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      sheet={manageKind ? {
        isPresented: true,
        onChanged: (v: boolean) => {
          if (!v) {
            setManageKind(null)
            const c = loadCustom()
            setCustomCount(c.backends.length + c.configs.length)
          }
        },
        content: (
          <ConvertManageSheet
            kind={manageKind}
            onClose={(msg) => {
              setManageKind(null)
              const c = loadCustom()
              setCustomCount(c.backends.length + c.configs.length)
              if (msg) setMessage(msg)
            }}
          />
        ),
      } : {
        isPresented: false,
        onChanged: () => {},
        content: <VStack />,
      }}
    >
      <Section
        title="小组件"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">桌面小组件由 iOS 系统定期自动刷新（通常几十分钟到数小时一次），数据为准实时。添加/删除订阅或小组件数据不更新时，可在此手动请求重载。</Text>}
      >
        <Button action={reloadWidget}>
          <HStack spacing={10}>
            <Image systemName="arrow.triangle.2.circlepath" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemGreen">立即重载桌面小组件</Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>

      <Section
        title="数据"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">清除后所有订阅的流量快照会被丢弃，下次刷新重新获取；订阅配置（链接/名称/UA）不受影响。</Text>}
      >
        <Button action={clearCache}>
          <HStack spacing={10}>
            <Image systemName="trash" foregroundStyle="systemRed" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemRed">{confirmClear ? "再点一次确认清除" : "清除流量缓存"}</Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>

      <Section
        title="订阅转换"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">转换页使用 subconverter 后端生成转换链接；此处管理你自有的后端与规则文件。</Text>}
      >
        <Button action={() => setManageKind("backend")}>
          <HStack spacing={10}>
            <Image systemName="server.rack" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemGreen">管理自定义后端</Text>
            <Spacer />
            <Text font={12} foregroundStyle="tertiaryLabel">{customBackendCountLabel()}</Text>
          </HStack>
        </Button>
        <Button action={() => setManageKind("config")}>
          <HStack spacing={10}>
            <Image systemName="doc.text" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
            <Text font={15} foregroundStyle="systemGreen">管理自定义远程配置</Text>
            <Spacer />
            <Text font={12} foregroundStyle="tertiaryLabel">{customConfigCountLabel()}</Text>
          </HStack>
        </Button>
      </Section>

      <Section title="关于">
        <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
          <Text font={13} foregroundStyle="secondaryLabel">数据来源</Text>
          <Text font={12} foregroundStyle="tertiaryLabel">直接请求你的订阅链接读取流量信息，不经任何第三方。</Text>
        </VStack>
        <VStack alignment="leading" spacing={6} padding={{ vertical: 2 }}>
          <Text font={13} foregroundStyle="secondaryLabel">灵感来源</Text>
          <Link url="https://github.com/youshandefeiyang/sub-web-modify"><Text font={13} foregroundStyle="systemGreen">youshandefeiyang/sub-web-modify</Text></Link>
        </VStack>
        <HStack spacing={10}>
          <Image systemName="info.circle" foregroundStyle="systemGreen" frame={{ width: ICON_W }} font={14} />
          <Text font={15} foregroundStyle="label">版本</Text>
          <Spacer />
          <Text font={13} foregroundStyle="secondaryLabel">1.0.0</Text>
        </HStack>
      </Section>

      {message ? (
        <Section>
          <Text font={12} foregroundStyle="secondaryLabel">{message}</Text>
        </Section>
      ) : null}
    </List>
  )
}

export default function SettingsViewPreview() {
  return (
    <VStack
      spacing={0}
      frame={{ width: 390, height: 700 }}
      background={{ style: { light: "#f2f2f7", dark: "#0d1117" }, shape: "rect" }}
    >
      <SettingsView />
    </VStack>
  )
}