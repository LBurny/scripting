// views/SettingsView.tsx — 应用设置（从订阅页进入）
// 深色阅读：底色风格三选一 + 字体亮度 + 图片亮度（均仅影响深色模式下的文章页）
// 手势：文章阅读页 双击/左滑/右滑 → 动作映射（lib/gestures.ts 注册表）

import {
  List, Section, VStack, HStack, Text, Button, Image, Spacer, Slider, Picker, Toggle,
  useState,
} from "scripting"
import { loadSettings, saveSettings, AppSettings, PAGE_TRANSITIONS, PAGE_TRANSITION_LABELS, PageTransition } from "../lib/store"
import { DARK_THEMES, DarkReadTheme } from "../lib/util"
import { GESTURES, GESTURE_ACTIONS, GESTURE_ACTION_LABELS, GestureActionId } from "../lib/gestures"

/** 设置行通用图标列宽（对齐 FeedsView 的 ICON_W） */
const ICON_W = 26

export function SettingsView() {
  const [s, setS] = useState<AppSettings>(() => loadSettings())

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    saveSettings(next)
  }

  return (
    <List
      navigationTitle="应用设置"
      navigationBarTitleDisplayMode="inline"
    >
      <Section
        title="已读标记"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">划过标记：在文章列表向下滑动、文章行滚出屏幕顶部时自动标为已读；未读列表中被划过的文章会在下次进入时才消失。</Text>}
      >
        <Toggle
          value={s.markReadOnOpen}
          tint={("systemOrange") as any}
          onChanged={(v: boolean) => update({ markReadOnOpen: v })}
        >
          <HStack spacing={10}>
            <Image systemName="envelope.open" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="label">进入文章时标记已读</Text>
          </HStack>
        </Toggle>
        <Toggle
          value={s.markReadOnScroll}
          tint={("systemOrange") as any}
          onChanged={(v: boolean) => update({ markReadOnScroll: v })}
        >
          <HStack spacing={10}>
            <Image systemName="arrow.up.to.line" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="label">划过文章时标记已读</Text>
          </HStack>
        </Toggle>
      </Section>
      <Section
        title="手势"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">手势在文章阅读页内生效；左滑＝下一篇（列表下一行、较旧），右滑＝上一篇（上一行、较新）。翻页动画作用于换文/加载全文换页（横向滑动时新页从切换方向滑入），对之后切换到的文章生效。</Text>}
      >
        <HStack spacing={10}>
          <Image systemName="sparkles" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
          <Text font={15} foregroundStyle="label">翻页动画</Text>
          <Spacer />
          <Picker
            label={<Text font={15} foregroundStyle={("clear") as any}>{PAGE_TRANSITION_LABELS[s.pageTransition]}</Text>}
            pickerStyle="menu"
            value={s.pageTransition}
            onChanged={(v: string) => update({ pageTransition: v as PageTransition })}
          >
            {PAGE_TRANSITIONS.map(t => (
              <Text key={t} tag={t} font={15} foregroundStyle="label">{PAGE_TRANSITION_LABELS[t]}</Text>
            ))}
          </Picker>
        </HStack>
        {GESTURES.map(g => (
          <HStack key={g.id} spacing={10}>
            <Image systemName={g.icon} foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="label">{g.label}</Text>
            <Spacer />
            <Picker
              label={<Text font={15} foregroundStyle={("clear") as any}>{GESTURE_ACTION_LABELS[s.gestures[g.id]]}</Text>}
              pickerStyle="menu"
              value={s.gestures[g.id]}
              onChanged={(v: string) => update({ gestures: { ...s.gestures, [g.id]: v as GestureActionId } })}
            >
              {GESTURE_ACTIONS.map(a => (
                <Text key={a} tag={a} font={15} foregroundStyle="label">{GESTURE_ACTION_LABELS[a]}</Text>
              ))}
            </Picker>
          </HStack>
        ))}
      </Section>
      <Section
        title="阅读"
        footer={<Text font={11} foregroundStyle="tertiaryLabel">深色阅读仅影响深色模式下的文章页，浅色模式始终为白底；设置对下次打开的文章生效。</Text>}
      >
        {(Object.keys(DARK_THEMES) as DarkReadTheme[]).map(k => {
          const t = DARK_THEMES[k]
          const selected = s.darkReadTheme === k
          return (
            <Button
              key={k}
              action={() => update({ darkReadTheme: k })}
            >
              <HStack spacing={12}>
                {/* 色样：胶囊形底色 + 实际文字色的 Aa，所见即所得 */}
                <HStack
                  frame={{ width: 36, height: 22 }}
                  background={{ style: t.bg, shape: "capsule" }}
                >
                  <Text font={11} fontWeight="semibold" foregroundStyle={(t.text) as any}>Aa</Text>
                </HStack>
                <Text font={15} foregroundStyle="label">{t.label}</Text>
                <Spacer />
                {selected ? <Image systemName="checkmark" font={14} foregroundStyle="systemOrange" /> : null}
              </HStack>
            </Button>
          )
        })}
      </Section>
      <Section title="深色模式" footer={<Text font={11} foregroundStyle="tertiaryLabel">调低字体/图片亮度，减弱夜间阅读的眩光刺眼感。</Text>}>
        <VStack alignment="leading" spacing={8}>
          <HStack>
            <Image systemName="a.circle.fill" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="label">字体亮度</Text>
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel" monospacedDigit>{Math.round(s.darkTextBrightness * 100)}%</Text>
          </HStack>
          <Slider
            min={0.5} max={1} step={0.01}
            value={s.darkTextBrightness}
            tint={("systemOrange") as any}
            onChanged={(v: number) => update({ darkTextBrightness: v })}
          />
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <HStack>
            <Image systemName="photo" foregroundStyle="systemOrange" frame={{ width: ICON_W }} />
            <Text font={15} foregroundStyle="label">图片亮度</Text>
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel" monospacedDigit>{Math.round(s.darkImageBrightness * 100)}%</Text>
          </HStack>
          <Slider
            min={0.4} max={1} step={0.01}
            value={s.darkImageBrightness}
            tint={("systemOrange") as any}
            onChanged={(v: number) => update({ darkImageBrightness: v })}
          />
        </VStack>
      </Section>
    </List>
  )
}