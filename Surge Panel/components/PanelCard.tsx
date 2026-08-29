// 圆角内容块（总览图表、流量分区等）
import { VStack } from "scripting"
import { UI, cardBackground } from "../lib/ui"

export function PanelCard({
  children,
  spacing = UI.cardSpacing,
  padding = UI.cardPadding,
}: {
  children: any
  spacing?: number
  padding?: number
}) {
  return (
    <VStack
      alignment="leading"
      spacing={spacing}
      padding={padding}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={cardBackground()}
    >
      {children}
    </VStack>
  )
}
