// 请求 Tab 顶部分段器，放进 List 内以便下拉刷新作用在整页
import { Picker, Text } from "scripting"
import { setRequestsSegment, useStoreSelector, type RequestsSegment } from "../lib/store"

export const REQUESTS_SEGMENTS: { id: RequestsSegment; title: string }[] = [
  { id: "active", title: "活动" },
  { id: "recent", title: "最近" },
  { id: "events", title: "事件" },
  { id: "dns", title: "DNS" },
  { id: "rules", title: "规则" },
]

export function RequestsSegmentBar() {
  const segment = useStoreSelector((s) => s.requestsSegment)
  return (
    <Picker
      label={<Text>请求分段</Text>}
      pickerStyle="segmented"
      value={segment}
      onChanged={(v: string) => setRequestsSegment(v as RequestsSegment)}
    >
      {REQUESTS_SEGMENTS.map((s) => (
        <Text key={s.id} tag={s.id}>{s.title}</Text>
      ))}
    </Picker>
  )
}
