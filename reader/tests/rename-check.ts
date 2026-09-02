// tests/rename-check.ts — renameFeed / feedDisplayTitle 回归验证
// 运行：scripting-ts run reader/tests/rename-check.ts
// 结果写工作区 rename-check-result.txt（stdout 拿不到）

import { loadFeeds, saveFeeds, loadArticles, renameFeed, feedDisplayTitle, flushArticles } from "../lib/store"

const OUT = FileManager.appGroupDocumentsDirectory + "/scripting-agent/workspace/default/rename-check-result.txt"
const lines: string[] = []
let pass = 0
let fail = 0

function ok(cond: boolean, name: string) {
  if (cond) { pass++; lines.push("PASS " + name) }
  else { fail++; lines.push("FAIL " + name) }
}

// 快照原始数据，结束后恢复
const origFeeds = JSON.parse(JSON.stringify(loadFeeds()))
const origArticlesRaw = FileManager.existsSync(FileManager.appGroupDocumentsDirectory + "/reader/articles.json")
  ? FileManager.readAsStringSync(FileManager.appGroupDocumentsDirectory + "/reader/articles.json")
  : null

try {
  // 1) 假源：重命名 → customTitle 生效
  const fake = { url: "https://example.com/__rename_test__.xml", title: "原始标题", siteUrl: "https://example.com", addedAt: 0 }
  saveFeeds([...loadFeeds(), fake])
  renameFeed(fake.url, "  新名字  ")
  let f = loadFeeds().find(x => x.url === fake.url)!
  ok(f.customTitle === "新名字", "重命名后 customTitle 已 trim 并保存")
  ok(feedDisplayTitle(f) === "新名字", "feedDisplayTitle 自定义名优先")

  // 2) 改回与源标题相同 → 清除自定义名
  renameFeed(fake.url, "原始标题")
  f = loadFeeds().find(x => x.url === fake.url)!
  ok(f.customTitle === undefined, "改回原标题后 customTitle 清除")
  ok(feedDisplayTitle(f) === "原始标题", "清除后回退到源标题")

  // 3) 空串 → 清除自定义名
  renameFeed(fake.url, "临时名")
  renameFeed(fake.url, "   ")
  f = loadFeeds().find(x => x.url === fake.url)!
  ok(f.customTitle === undefined, "空名称清除 customTitle")

  // 4) 不存在的 url → 无操作不抛错
  let threw = false
  try { renameFeed("https://nonexistent.example/feed", "x") } catch { threw = true }
  ok(!threw, "重命名不存在的源静默无操作")

  // 5) 真实源：文章 feedTitle 同步改写并可恢复
  const realArticles = loadArticles()
  const realFeed = loadFeeds().find(fd => fd.url !== fake.url && realArticles.some(a => a.feedUrl === fd.url))
  if (realFeed) {
    const before = realArticles.filter(a => a.feedUrl === realFeed.url).map(a => a.feedTitle)
    renameFeed(realFeed.url, "测试改名X")
    const after = loadArticles().filter(a => a.feedUrl === realFeed.url)
    ok(after.length > 0 && after.every(a => a.feedTitle === "测试改名X"), "缓存文章 feedTitle 同步改写")
    // 恢复：无自定义名的源改回原标题
    renameFeed(realFeed.url, realFeed.title)
    const restored = loadArticles().filter(a => a.feedUrl === realFeed.url)
    ok(restored.every(a => a.feedTitle === realFeed.title), "改回后文章 feedTitle 恢复")
    ok(JSON.stringify(before) === JSON.stringify(restored.map(a => a.feedTitle)), "文章来源名与改名前一致")
  } else {
    lines.push("SKIP 无带文章的真实源，跳过第 5 组")
  }
} finally {
  // 恢复现场：源列表去掉假源；文章文件按原始快照还原
  saveFeeds(origFeeds)
  if (origArticlesRaw !== null) {
    FileManager.writeAsStringSync(FileManager.appGroupDocumentsDirectory + "/reader/articles.json", origArticlesRaw)
  }
  flushArticles()
}

lines.push(`\n${pass} passed, ${fail} failed`)
FileManager.writeAsStringSync(OUT, lines.join("\n"))
