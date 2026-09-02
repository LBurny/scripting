// lib/bus.ts — 数据变更广播：刷新/已读/增删订阅源后通知各 Tab 重载

type Listener = () => void
const listeners = new Set<Listener>()

export function onDataChanged(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function emitDataChanged() {
  listeners.forEach(l => l())
}
