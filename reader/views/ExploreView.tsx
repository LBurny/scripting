// views/ExploreView.tsx — 内置订阅源目录：浏览并一键添加

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, Picker,
  useState, useEffect,
} from "scripting"
import { FEED_DIRECTORY, DirectoryEntry } from "../lib/directory"
import { loadFeeds, addFeed } from "../lib/store"
import { emitDataChanged } from "../lib/bus"

const LANG_LABELS: Record<string, string> = { zh: "中文", en: "EN", ja: "日本語" }
const LANG_FILTERS = ["all", "zh", "en", "ja"] as const
const LANG_FILTER_TITLES: Record<string, string> = { all: "全部", zh: "中文", en: "English", ja: "日本語" }

/** 同一含义的分类在不同语言里名字不同，归一化后归组（模块级常量，勿放函数体内每次新建） */
const CATEGORY_MAP: Record<string, string> = {
  Tech: "科技", "テック": "科技",
  Programming: "编程", "プログラミング": "编程",
  News: "新闻", "ニュース": "新闻",
  Science: "科学",
  Design: "设计", "デザイン": "设计",
  Business: "商业",
  Culture: "文化",
  Gaming: "游戏", "ゲーム": "游戏",
  Lifestyle: "生活", "ライフスタイル": "生活",
  Sports: "体育",
  AI: "AI",
  Entertainment: "娱乐", "エンタメ": "娱乐",
  Society: "社会",
}
function canonicalCategory(cat: string): string {
  return CATEGORY_MAP[cat] ?? cat
}

function ExploreRow({ entry, added, busy, onAdd }: {
  entry: DirectoryEntry
  added: boolean
  busy: boolean
  onAdd: () => void
}) {
  return (
    <HStack spacing={10}>
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <HStack spacing={6}>
          <Text font={15} fontWeight="medium" lineLimit={1}>{entry.title}</Text>
          <Text
            font={9}
            foregroundStyle="systemOrange"
            padding={{ horizontal: 5, vertical: 1.5 }}
            background="rgba(255,159,10,0.14)"
            clipShape="capsule"
          >
            {LANG_LABELS[entry.lang] ?? entry.lang}
          </Text>
        </HStack>
        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={2}>
          {entry.description}
        </Text>
      </VStack>
      {added ? (
        <Image
          systemName="checkmark.circle.fill"
          font={22}
          foregroundStyle="systemGreen"
          frame={{ width: 34, height: 34 }}
        />
      ) : busy ? (
        <Text font={15} foregroundStyle="tertiaryLabel" frame={{ width: 34, height: 34 }}>…</Text>
      ) : (
        <Button action={onAdd} buttonStyle="plain" contentShape="rect" frame={{ width: 34, height: 34 }} accessibilityLabel={`添加 ${entry.title}`}>
          <Image systemName="plus.circle.fill" font={22} foregroundStyle="systemOrange" />
        </Button>
      )}
    </HStack>
  )
}

export function ExploreView() {
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set())
  const [busyUrl, setBusyUrl] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [langFilter, setLangFilter] = useState<string>("all")

  useEffect(() => {
    setSubscribed(new Set(loadFeeds().map(f => f.url)))
  }, [])

  async function handleAdd(entry: DirectoryEntry) {
    setBusyUrl(entry.feedUrl)
    setMessage("")
    try {
      await addFeed(entry.feedUrl)
      setSubscribed(prev => new Set(prev).add(entry.feedUrl))
      emitDataChanged()
    } catch (e: any) {
      setMessage(`「${entry.title}」添加失败：` + (e?.message ?? String(e)))
    } finally {
      setBusyUrl(null)
    }
  }

  const filtered = FEED_DIRECTORY.filter(e => langFilter === "all" || e.lang === langFilter)

  // 按归一化分类归组，保持目录中的出现顺序（Map 单遍，不用 groups.find 的 O(n²)）
  const groupMap = new Map<string, DirectoryEntry[]>()
  for (const e of filtered) {
    const cat = canonicalCategory(e.category)
    const arr = groupMap.get(cat)
    if (arr) arr.push(e)
    else groupMap.set(cat, [e])
  }
  const groups = [...groupMap].map(([category, items]) => ({ category, items }))

  return (
    <List navigationTitle="发现订阅源" navigationBarTitleDisplayMode="inline" contentMargins={{ edges: "top" as any, insets: 20 }}>
      <Section>
        <Picker
          label={<Text>语言筛选</Text>}
          pickerStyle="segmented"
          value={langFilter}
          onChanged={(v: string) => setLangFilter(v)}
        >
          {LANG_FILTERS.map(l => (
            <Text key={l} tag={l}>{LANG_FILTER_TITLES[l]}</Text>
          ))}
        </Picker>
        {message ? (
          <Text font={12} foregroundStyle="systemRed">{message}</Text>
        ) : null}
      </Section>

      {groups.map(g => (
        <Section key={g.category} title={`${g.category}（${g.items.length}）`}>
          {g.items.map(e => (
            <ExploreRow
              key={e.feedUrl}
              entry={e}
              added={subscribed.has(e.feedUrl)}
              busy={busyUrl === e.feedUrl}
              onAdd={() => handleAdd(e)}
            />
          ))}
        </Section>
      ))}
    </List>
  )
}
