// lib/bus.ts — 数据变更广播：刷新/增删改订阅后通知各视图重载（仿 reader/lib/bus.ts）

type Listener = () => void
const listeners = new Set<Listener>()

export function onDataChanged(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function emitDataChanged() {
  listeners.forEach((l) => l())
}