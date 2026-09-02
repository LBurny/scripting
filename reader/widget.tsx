// widget.tsx — Reader 小组件：未读数 + 最新文章，点击进入 App

import {
  Widget, Script, VStack, HStack, Text, Image, Spacer,
} from "scripting"
import { Article, loadArticles, refreshAll } from "./lib/store"
import { relativeTime } from "./lib/util"

// 各尺寸排版参数（小/中统一 3 条，小号字号略缩；大号 6 条）
const LAYOUTS: Record<string, { count: number; title: number; meta: number; spacing: number }> = {
  systemSmall: { count: 3, title: 11, meta: 8, spacing: 6 },
  systemMedium: { count: 3, title: 12, meta: 9, spacing: 8 },
}
const LARGE_LAYOUT = { count: 6, title: 13, meta: 10, spacing: 10 }

function Header({ unread, metaSize }: { unread: number; metaSize: number }) {
  return (
    <HStack spacing={6}>
      <Image systemName="dot.radiowaves.up.forward" font={14} foregroundStyle="orange" />
      <Text font={14} fontWeight="bold" lineLimit={1} minScaleFactor={0.8}>Reader</Text>
      <Spacer />
      <Text font={12} foregroundStyle="gray" monospacedDigit lineLimit={1}>
        {unread > 0 ? `${unread} 未读` : "已读完"}
      </Text>
    </HStack>
  )
}

function ArticleItem({ article, titleSize, metaSize }: { article: Article; titleSize: number; metaSize: number }) {
  return (
    <VStack alignment="leading" spacing={1}>
      <Text font={titleSize} fontWeight="medium" lineLimit={1}>
        {article.title}
      </Text>
      <HStack spacing={4}>
        <Text font={metaSize} foregroundStyle="orange" lineLimit={1}>{article.feedTitle}</Text>
        <Text font={metaSize} foregroundStyle="gray">{relativeTime(article.date)}</Text>
      </HStack>
    </VStack>
  )
}

function WidgetView() {
  const articles = loadArticles()
  const unread = articles.filter(a => !a.read)
  const list = unread.length > 0 ? unread : articles
  const runURL = Script.createRunURLScheme("reader")
  const layout = LAYOUTS[Widget.family] ?? LARGE_LAYOUT
  const shown = list.slice(0, layout.count)

  return (
    <VStack
      spacing={layout.spacing}
      alignment="leading"
      padding={{ top: 13, leading: 14, trailing: 14, bottom: 11 }}
      widgetURL={runURL}
    >
      <Header unread={unread.length} metaSize={layout.meta} />
      {shown.map(a => (
        <ArticleItem key={a.id} article={a} titleSize={layout.title} metaSize={layout.meta} />
      ))}
      {shown.length === 0 ? (
        <VStack spacing={4}>
          <Spacer />
          <Text font={13} foregroundStyle="gray">暂无文章，点击进入刷新</Text>
          <Spacer />
        </VStack>
      ) : null}
      <Spacer />
    </VStack>
  )
}

async function run() {
  // 小组件时间线允许短暂联网：先刷新再渲染（失败/超时则用缓存）
  // 加 5s 超时：网络差时避免拖垮 WidgetKit 时间线预算，保证及时用缓存渲染
  try {
    await Promise.race([
      refreshAll(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("widget refresh timeout")), 5000)),
    ])
  } catch {}
  Widget.present(<WidgetView />)
}

run()
