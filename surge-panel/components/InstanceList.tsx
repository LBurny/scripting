// 实例切换列表（总览 sheet / 设置入口共用）
import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Text,
  VStack,
} from "scripting"
import { instanceSubtitle, type SurgeInstance } from "../lib/instances"
import { switchInstance, useStoreSelector } from "../lib/store"

export function InstanceList({
  onAdd,
  onEdit,
}: {
  onAdd?: () => void
  onEdit?: (inst: SurgeInstance) => void
}) {
  const { instances, activeId } = useStoreSelector((s) => ({
    instances: s.instances,
    activeId: s.activeId,
  }))

  return (
    <List navigationTitle="实例">
      <Section footer={<Text font={13}>一次只连接一个 Surge HTTP API。点按切换，不会重新打开面板。</Text>}>
        {instances.length === 0 ? (
          <Text font={15} foregroundStyle="secondaryLabel">
            还没有实例。添加本机或网关的 HTTP API 后才会连接。
          </Text>
        ) : (
          instances.map((inst) => {
          const active = inst.id === activeId
          return (
            <HStack
              key={inst.id}
              spacing={10}
              onTapGesture={() => {
                void switchInstance(inst.id)
              }}
            >
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font={17} fontWeight={active ? "semibold" : "regular"}>{inst.name}</Text>
                <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>
                  {instanceSubtitle(inst)}
                </Text>
              </VStack>
              {onEdit ? (
                <Button
                  title="编辑"
                  buttonStyle="borderless"
                  action={() => onEdit(inst)}
                />
              ) : null}
              {active ? (
                <Image systemName="checkmark.circle.fill" foregroundStyle="systemBlue" font={18} />
              ) : (
                <Image systemName="circle" foregroundStyle="tertiaryLabel" font={18} />
              )}
            </HStack>
          )
        })
        )}
      </Section>
      {onAdd ? (
        <Section>
          <Button title="添加实例" systemImage="plus.circle" action={onAdd} />
        </Section>
      ) : null}
    </List>
  )
}
