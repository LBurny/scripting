// 读取 changelog.md：内容变化时弹出更新说明（与 BlackCCCat/Scripting-Scripts 相同用法）
import {
  Device,
  Markdown,
  NavigationStack,
  Path,
  Script,
  ScrollView,
  Text,
  useEffect,
  useState,
  type MarkdownProps,
  type PresentationDetent,
} from "scripting"

const DEFAULT_CHANGELOG_FILE = "changelog.md"

function normalizeMarkdownContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim()
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function MarkdownReleaseNotesSheet({
  content,
  title,
  theme,
  detents,
}: {
  content: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
}) {
  const useGlass = Number.parseInt(Device.systemVersion, 10) >= 26
  return (
    <NavigationStack presentationBackground={useGlass ? "clear" : undefined}>
      <ScrollView
        background="clear"
        scrollContentBackground="hidden"
        navigationTitle={title ?? "更新说明"}
        navigationBarTitleDisplayMode="inline"
        toolbarBackgroundVisibility="hidden"
        presentationDragIndicator="visible"
        presentationDetents={detents ?? ["medium", "large"]}
        presentationBackground={useGlass ? "clear" : undefined}
        padding={{ top: 24, leading: 18, bottom: 18, trailing: 18 }}
      >
        <Markdown
          content={content}
          theme={theme ?? "basic"}
          useDefaultHighlighterTheme
          scrollable={false}
          background="clear"
        />
      </ScrollView>
    </NavigationStack>
  )
}

export function ChangelogView() {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const filePath = Path.join(Script.directory, DEFAULT_CHANGELOG_FILE)
    FileManager.exists(filePath)
      .then((ok: boolean) => {
        if (!ok) throw new Error("未找到 changelog.md")
        return FileManager.readAsString(filePath)
      })
      .then((raw: string) => {
        if (!cancelled) setContent(normalizeMarkdownContent(raw))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ScrollView axes="vertical" navigationTitle="更新说明" padding={18}>
      {error ? (
        <Text foregroundStyle="systemRed">{error}</Text>
      ) : content ? (
        <Markdown content={content} theme="basic" useDefaultHighlighterTheme scrollable={false} />
      ) : (
        <Text foregroundStyle="secondaryLabel">加载中…</Text>
      )}
    </ScrollView>
  )
}

export function useMarkdownReleaseNotesSheet({
  markdownFile = DEFAULT_CHANGELOG_FILE,
  storageKey = `release-notes:${DEFAULT_CHANGELOG_FILE}:last-seen-hash`,
  title = "更新说明",
  theme,
  detents,
  markAsSeenOnDismiss = true,
}: {
  markdownFile?: string
  storageKey?: string
  title?: string
  theme?: MarkdownProps["theme"]
  detents?: PresentationDetent[]
  markAsSeenOnDismiss?: boolean
} = {}) {
  const [releaseNotesContent, setReleaseNotesContent] = useState("")
  const [releaseNotesHash, setReleaseNotesHash] = useState("")
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  useEffect(() => {
    async function load() {
      const filePath = Path.join(Script.directory, markdownFile)
      if (!(await FileManager.exists(filePath))) return
      const content = normalizeMarkdownContent(await FileManager.readAsString(filePath))
      if (!content) return
      const contentHash = hashString(content)
      const lastSeenHash = Storage.get<string>(storageKey)
      if (lastSeenHash === contentHash) return
      setReleaseNotesContent(content)
      setReleaseNotesHash(contentHash)
      setShowReleaseNotes(true)
    }
    void load()
  }, [])

  function setReleaseNotesPresented(isPresented: boolean) {
    if (!isPresented && markAsSeenOnDismiss && releaseNotesHash) {
      Storage.set(storageKey, releaseNotesHash)
    }
    setShowReleaseNotes(isPresented)
  }

  return {
    isPresented: showReleaseNotes,
    onChanged: setReleaseNotesPresented,
    content: (
      <MarkdownReleaseNotesSheet
        content={releaseNotesContent}
        title={title}
        theme={theme}
        detents={detents}
      />
    ),
  }
}
