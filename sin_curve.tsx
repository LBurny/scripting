import { VStack, HStack, Text, Slider, Canvas, useState } from "scripting"

export default function SinCurveView() {
  const [freq, setFreq] = useState(1)
  const width = 320
  const height = 180
  const xMax = 2 * Math.PI * freq
  const amp = 60

  return (
    <VStack spacing={12} padding={16}>
      <Text font="headline">y = sin(x) · {freq.toFixed(2)}x</Text>
      <Canvas
        frame={{ width: width, height: height }}
        opaque={false}
        draw={(ctx, size) => {
          const midY = size.height / 2
          // axes
          ctx.strokeStyle = "systemGray3"
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, midY)
          ctx.lineTo(size.width, midY)
          for (let k = 0; k <= freq * 2; k++) {
            const px = (k / (freq * 2)) * size.width
            ctx.moveTo(px, midY - 4)
            ctx.lineTo(px, midY + 4)
          }
          ctx.stroke()
          // sin curve
          ctx.strokeStyle = "systemBlue"
          ctx.lineWidth = 2.5
          ctx.lineJoin = "round"
          ctx.beginPath()
          const n = 300
          for (let i = 0; i <= n; i++) {
            const t = (i / n) * size.width
            const y = midY - Math.sin((i / n) * xMax) * amp
            if (i === 0) ctx.moveTo(t, y)
            else ctx.lineTo(t, y)
          }
          ctx.stroke()
        }}
      />
      <HStack spacing={8}>
        <Text font="footnote">频率</Text>
        <Slider min={0.25} max={4} step={0.05} value={freq} onChanged={setFreq} />
      </HStack>
    </VStack>
  )
}