// views/FeedsView.tsx — 订阅源管理 Tab

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, NavigationLink,
  TextField, Group, useState, useEffect,
} from "scripting"
import { Feed, loadFeeds, addFeed, removeFeed, renameFeed, feedDisplayTitle, loadArticles } from "../lib/store"
import { emitDataChanged, onDataChanged } from "../lib/bus"
import { ExploreView } from "./ExploreView"
import { ArticleListView } from "./ArticleListView"
import { SettingsView } from "./SettingsView"

/** 行首图标统一占位宽度，保证三行文字左缘对齐 */
const ICON_W = 26

/** 手动添加订阅源的 sheet 内容 */
export function AddFeedSheet({ onClose }: { onClose: (message?: string) => void }) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    const u = url.trim()
    if (!u) {
      setError("请输入订阅地址")
      return
    }
    setBusy(true)
    setError("")
    try {
      const feed = await addFeed(u)
      emitDataChanged()
      onClose(`已添加「${feed.title}」`)
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
        <Text font={16} fontWeight="semibold">手动添加订阅源</Text>
        <Spacer />
        <Button title={busy ? "添加中…" : "添加"} fontWeight="semibold" action={submit} />
      </HStack>
      <List>
        <Section footer={<Text font={12} foregroundStyle="tertiaryLabel">支持 RSS / Atom 地址，省略 https:// 会自动补全</Text>}>
          <TextField
            title="订阅地址"
            prompt="https://example.com/feed.xml"
            value={url}
            onChanged={(v: string) => { setUrl(v); setError("") }}
            autofocus
          />
        </Section>
        {error ? (
          <Text font={13} foregroundStyle="systemRed">{error}</Text>
        ) : null}
      </List>
    </VStack>
  )
}

/** 重命名订阅源的 sheet 内容 */
export function RenameFeedSheet({ feed, onClose }: { feed: Feed; onClose: (message?: string) => void }) {
  const [name, setName] = useState(feedDisplayTitle(feed))
  const [error, setError] = useState("")

  function submit() {
    const n = name.trim()
    if (!n) {
      setError("名称不能为空")
      return
    }
    renameFeed(feed.url, n)
    emitDataChanged()
    onClose(n === feed.title ? `已恢复源标题「${n}」` : `已重命名为「${n}」`)
  }

  return (
    <VStack spacing={0}>
      <HStack padding={{ top: 16, leading: 16, bottom: 4, trailing: 16 }}>
        <Button title="取消" action={() => onClose()} />
        <Spacer />
        <Text font={16} fontWeight="semibold">重命名订阅源</Text>
        <Spacer />
        <Button title="保存" fontWeight="semibold" action={submit} />
      </HStack>
      <List>
        <Section footer={<Text font={12} foregroundStyle="tertiaryLabel">输入与源原标题相同的名称可恢复默认（{feed.title}）</Text>}>
          <TextField
            title="名称"
            prompt={feed.title}
            value={name}
            onChanged={(v: string) => { setName(v); setError("") }}
            autofocus
          />
        </Section>
        {error ? (
          <Text font={13} foregroundStyle="systemRed">{error}</Text>
        ) : null}
      </List>
    </VStack>
  )
}

export function FeedsView() {
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [showAdd, setShowAdd] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Feed | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    // 数据加载期一次构建文章计数 Map，渲染期只查表（不要每行 loadArticles）
    const reload = () => {
      setFeeds(loadFeeds())
      const m = new Map<string, number>()
      for (const a of loadArticles()) m.set(a.feedUrl, (m.get(a.feedUrl) ?? 0) + 1)
      setCounts(m)
    }
    reload()
    return onDataChanged(reload)
  }, [])

  function handleRemove(url: string) {
    removeFeed(url)
    emitDataChanged()
  }

  return (
    <List
      navigationTitle="订阅源"
      navigationBarTitleDisplayMode="inline"
      contentMargins={{ edges: "top" as any, insets: 20 }}
      sheet={renameTarget ? {
        isPresented: true,
        onChanged: (v: boolean) => { if (!v) setRenameTarget(null) },
        content: (
          <RenameFeedSheet
            feed={renameTarget}
            onClose={(msg) => {
              setRenameTarget(null)
              if (msg) setMessage(msg)
            }}
          />
        ),
      } : {
        isPresented: showAdd,
        onChanged: (v: boolean) => setShowAdd(v),
        content: (
          <AddFeedSheet
            onClose={(msg) => {
              setShowAdd(false)
              if (msg) setMessage(msg)
            }}
          />
        ),
      }}
    >
      <Section>
        <NavigationLink destination={<SettingsView />}>
          <HStack spacing={10}>
            <Image systemName="gearshape" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15}>应用设置</Text>
            <Spacer />
          </HStack>
        </NavigationLink>
        <NavigationLink destination={<ExploreView />}>
          <HStack spacing={10}>
            <Image systemName="square.grid.2x2" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15}>发现订阅源</Text>
            <Spacer />
            <Text font={12} foregroundStyle="tertiaryLabel">137 个精选源</Text>
          </HStack>
        </NavigationLink>
        <Button action={() => setShowAdd(true)}>
          <HStack spacing={10}>
            <Image systemName="plus.circle.fill" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="systemOrange">手动添加订阅源</Text>
            <Spacer />
          </HStack>
        </Button>
        {message ? (
          <Text font={13} foregroundStyle="secondaryLabel">{message}</Text>
        ) : null}
      </Section>
      <Section title={`已订阅 ${feeds.length} 个源`} footer={<Text font={11} foregroundStyle="tertiaryLabel">点按进入源的文章列表，长按可重命名或删除</Text>}>
        {feeds.map(f => (
          <NavigationLink
            key={f.url}
            destination={<ArticleListView filter="all" feedUrl={f.url} title={feedDisplayTitle(f)} />}
          >
            <HStack
              spacing={10}
              contextMenu={{
                menuItems: (
                  <Group>
                    <Button title="重命名" systemImage="pencil" action={() => setRenameTarget(f)} />
                    <Button title="删除订阅源" systemImage="trash" role="destructive" action={() => handleRemove(f.url)} />
                  </Group>
                ),
              }}
            >
              <Image systemName="dot.radiowaves.up.forward" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
              <VStack alignment="leading" spacing={2}>
                <Text font={15} lineLimit={1}>{feedDisplayTitle(f)}</Text>
                <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>{f.url}</Text>
              </VStack>
              <Spacer />
              <Text font={12} foregroundStyle="secondaryLabel">{counts.get(f.url) ?? 0} 篇</Text>
            </HStack>
          </NavigationLink>
        ))}
        {feeds.length === 0 ? (
          <Text font={14} foregroundStyle="secondaryLabel">还没有订阅源，点上方按钮添加</Text>
        ) : null}
      </Section>
    </List>
  )
}
