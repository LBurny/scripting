// 临时验证脚本：store 缓存改造后的运行时行为（验证完即删）
import { loadArticles, loadFeeds, markRead, toggleStar, saveFulltext, unreadCount } from "./lib/store"

const OUT = FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/reader_perf_test.txt"
const log: string[] = []

try {
  const feeds = loadFeeds()
  log.push(`feeds=${feeds.length} titles=${feeds.map(f => f.title).join(",")}`)

  const a1 = loadArticles()
  const a2 = loadArticles()
  log.push(`articles=${a1.length} cacheSameRef=${a1 === a2}`)

  if (a1.length > 0) {
    const id = a1[0].id
    const changed = markRead(id)
    log.push(`markRead changed=${changed} readNow=${loadArticles()[0].read}`)
    const before = !!loadArticles()[0].starred
    toggleStar(id)
    const after = !!loadArticles()[0].starred
    log.push(`toggleStar ${before}->${after}`)
    toggleStar(id) // 还原
    const origFulltext = loadArticles()[0].fulltext
    saveFulltext(id, "<p>test</p>")
    log.push(`fulltext=${loadArticles()[0].fulltext}`)
    // 还原原始 fulltext（直接写文件，进程随即退出，缓存作废无影响）
    const arts = loadArticles()
    if (origFulltext === undefined) delete arts[0].fulltext
    else arts[0].fulltext = origFulltext
    FileManager.writeAsStringSync(
      FileManager.appGroupDocumentsDirectory + "/reader/articles.json",
      JSON.stringify(arts)
    )
  }
  log.push(`unread=${unreadCount()}`)
  log.push("OK")
} catch (e: any) {
  log.push("ERROR: " + (e?.message ?? String(e)))
}

FileManager.writeAsStringSync(OUT, log.join("\n"))
