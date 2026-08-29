// 渐变排行条
import {
  GeometryReader,
  gradient,
  HStack,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
  type Color,
} from "scripting"

export function GradientBar({
  label,
  valueText,
  ratio,
  colors,
}: {
  label: string
  valueText: string
  ratio: number // 0 ~ 1
  colors: Color[]
}) {
  const pct = Math.max(0.02, Math.min(1, ratio))
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={8}>
        <Text font={14} lineLimit={1} minScaleFactor={0.7}>{label}</Text>
        <Spacer />
        <Text font={13} foregroundStyle="secondaryLabel">{valueText}</Text>
      </HStack>
      <GeometryReader>
        {(proxy) => (
          <ZStack alignment="leading" frame={{ width: proxy.size.width, height: 10 }}>
            <RoundedRectangle cornerRadius={5} style="continuous" fill="rgba(128,128,128,0.22)" />
            <RoundedRectangle
              cornerRadius={5}
              style="continuous"
              fill={gradient("linear", { colors, startPoint: "leading", endPoint: "trailing" })}
              frame={{ width: Math.max(10, proxy.size.width * pct), height: 10 }}
            />
          </ZStack>
        )}
      </GeometryReader>
    </VStack>
  )
}
