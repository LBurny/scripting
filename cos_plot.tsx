import { Canvas, VStack, HStack, Text, Spacer } from "scripting"

const TWO_PI = Math.PI * 2
const X_MIN = -TWO_PI
const X_MAX = TWO_PI
const Y_MIN = -1.5
const Y_MAX = 1.5

const X_TICKS: Array<[number, string]> = [
  [-2, "-2π"], [-1.5, "-3π/2"], [-1, "-π"], [-0.5, "-π/2"],
  [0, "0"], [0.5, "π/2"], [1, "π"], [1.5, "3π/2"], [2, "2π"],
]
const Y_TICKS = [-1, -0.5, 0.5, 1]
const KEY_POINTS: Array<[number, number]> = [
  [0, 1], [Math.PI / 2, 0], [Math.PI, -1], [(3 * Math.PI) / 2, 0], [TWO_PI, 1],
]

export default function CosPlotView() {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={20}
      background="systemBackground"
      frame={{ maxWidth: Infinity, maxHeight: Infinity }}
    >
      <HStack alignment="center" spacing={8} frame={{ maxWidth: Infinity }}>
        <Text font="title2">y = cos(x)</Text>
        <Spacer />
        <Text font={13} foregroundColor="secondaryLabel">-2π ≤ x ≤ 2π</Text>
      </HStack>

      <Canvas
        frame={{ width: 340, height: 300 }}
        draw={(ctx, size) => {
          const padL = 46, padR = 18, padT = 24, padB = 32
          const plotW = size.width - padL - padR
          const plotH = size.height - padT - padB
          const px = (x: number) => padL + ((x - X_MIN) / (X_MAX - X_MIN)) * plotW
          const py = (y: number) => padT + (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * plotH
          const tri = (pts: Array<[number, number]>) => {
            ctx.beginPath()
            pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
            ctx.closePath()
            ctx.fill()
          }

          // 背景与绘图区
          ctx.fillStyle = "systemBackground"
          ctx.fillRect(0, 0, size.width, size.height)
          ctx.fillStyle = "secondarySystemBackground"
          ctx.fillRect(padL, padT, plotW, plotH)

          // 虚线网格
          ctx.strokeStyle = "systemGray"
          ctx.lineWidth = 1
          ctx.globalAlpha = 0.3
          ctx.setLineDash([4, 4])
          for (let k = -4; k <= 4; k++) {
            const x = (k * Math.PI) / 2
            if (k !== 0) {
              ctx.beginPath()
              ctx.moveTo(px(x), padT)
              ctx.lineTo(px(x), padT + plotH)
              ctx.stroke()
            }
          }
          for (const y of Y_TICKS) {
            ctx.beginPath()
            ctx.moveTo(padL, py(y))
            ctx.lineTo(padL + plotW, py(y))
            ctx.stroke()
          }
          ctx.setLineDash([])
          ctx.globalAlpha = 1

          // 坐标轴
          ctx.strokeStyle = "label"
          ctx.fillStyle = "label"
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(padL, py(0))
          ctx.lineTo(padL + plotW + 2, py(0))
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(px(0), padT + 2)
          ctx.lineTo(px(0), padT + plotH)
          ctx.stroke()
          // 箭头
          tri([[padL + plotW + 10, py(0)], [padL + plotW + 2, py(0) - 4.5], [padL + plotW + 2, py(0) + 4.5]])
          tri([[px(0), padT - 8], [px(0) - 4.5, padT], [px(0) + 4.5, padT]])

          // 刻度线
          ctx.lineWidth = 1
          for (const [x] of X_TICKS) {
            if (x !== 0) {
              ctx.beginPath()
              ctx.moveTo(px(x), py(0))
              ctx.lineTo(px(x), py(0) + 4)
              ctx.stroke()
            }
          }
          for (const y of Y_TICKS) {
            ctx.beginPath()
            ctx.moveTo(padL - 4, py(y))
            ctx.lineTo(padL, py(y))
            ctx.stroke()
          }

          // 刻度文字（用 measureText 手动定位，避免 textAlign 兼容性问题）
          ctx.fillStyle = "systemGray"
          ctx.font = 11
          ctx.textAlign = "left"
          ctx.textBaseline = "top"
          const yLabels: Array<[number, string]> = Y_TICKS.map((y) => [
            y,
            String(Math.abs(y) % 1 === 0 ? y : y.toFixed(1)),
          ])
          for (const [v, label] of X_TICKS) {
            const xr = v * Math.PI // X_TICKS 存的是 π 的倍数
            const w = ctx.measureText(label).width
            ctx.fillText(label, px(xr) - w / 2, py(0) + 7)
          }
          for (const [y, label] of yLabels) {
            const w = ctx.measureText(label).width
            ctx.fillText(label, padL - 7 - w, py(y) - 5)
          }

          // cos 曲线
          ctx.save()
          ctx.shadowColor = "rgba(0, 122, 255, 0.35)"
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
          ctx.strokeStyle = "systemBlue"
          ctx.lineWidth = 3
          ctx.lineJoin = "round"
          ctx.lineCap = "round"
          ctx.beginPath()
          const N = 480
          for (let i = 0; i <= N; i++) {
            const x = X_MIN + (i / N) * (X_MAX - X_MIN)
            const y = Math.cos(x)
            if (i === 0) ctx.moveTo(px(x), py(y))
            else ctx.lineTo(px(x), py(y))
          }
          ctx.stroke()
          ctx.restore()

          // 关键点空心圆点
          for (const [x, y] of KEY_POINTS) {
            ctx.beginPath()
            ctx.arc(px(x), py(y), 4.5, 0, TWO_PI)
            ctx.fillStyle = "systemBlue"
            ctx.fill()
            ctx.beginPath()
            ctx.arc(px(x), py(y), 2, 0, TWO_PI)
            ctx.fillStyle = "white"
            ctx.fill()
          }
        }}
      />

      <Text font={12} foregroundColor="secondaryLabel">
        蓝色圆点为关键点：(0, 1)、(π/2, 0)、(π, -1)、(3π/2, 0)、(2π, 1)
      </Text>
    </VStack>
  )
}