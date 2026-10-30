import type { AtlasEdgeKind, AtlasNodeKind } from '../../../../shared/neuro-atlas-contract'
import type { AtlasSimNode } from './atlas-graph-layout'

export const NODE_RADIUS = 7

export type AtlasCamera = { x: number; y: number; scale: number }

export type AtlasSceneColors = {
  node: Record<AtlasNodeKind, string>
  edge: Record<AtlasEdgeKind, string>
  dim: string
  selectedRing: string
}

export const kindColorToken: Record<AtlasNodeKind, [string, string]> = {
  file: ['--chart-2', '#3b82f6'],
  symbol: ['--chart-4', '#a371f7'],
  agent: ['--status-success', '#3fb950'],
  audit: ['--destructive', '#f85149']
}

export const edgeColorToken: Record<AtlasEdgeKind, [string, string]> = {
  imports: ['--chart-2', '#3b82f6'],
  calls: ['--chart-4', '#a371f7'],
  semantic: ['--muted-foreground', '#8b949e'],
  audit: ['--destructive', '#f85149']
}

export function cssColor(element: Element, token: [string, string]): string {
  const value = getComputedStyle(element).getPropertyValue(token[0]).trim()
  return value.length > 0 ? value : token[1]
}

/** Renders nodes/edges with camera transform, dimming, link-type dash styles, and selection ring. */
export function drawScene(
  canvas: HTMLCanvasElement,
  nodes: readonly AtlasSimNode[],
  edges: readonly { source: string; target: string; kind: AtlasEdgeKind }[],
  kindsById: ReadonlyMap<string, AtlasNodeKind>,
  camera: AtlasCamera,
  colors: AtlasSceneColors,
  selectedId: string | null
): void {
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  const dpr = window.devicePixelRatio || 1
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.translate(canvas.clientWidth / 2, canvas.clientHeight / 2)
  context.scale(camera.scale, camera.scale)
  context.translate(-camera.x, -camera.y)

  const highlight = selectedId !== null
  const linked = new Set<string>()
  if (selectedId !== null) {
    for (const edge of edges) {
      if (edge.source === selectedId) {
        linked.add(edge.target)
      }
      if (edge.target === selectedId) {
        linked.add(edge.source)
      }
    }
  }
  const dimmed = (id: string): boolean => highlight && id !== selectedId && !linked.has(id)

  const byId = new Map(nodes.map((node) => [node.id, node]))
  context.lineWidth = 1 / camera.scale
  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) {
      continue
    }
    context.strokeStyle = colors.edge[kindsById.get(edge.source) === 'audit' ? 'audit' : edge.kind]
    context.globalAlpha = dimmed(edge.source) || dimmed(edge.target) ? 0.12 : edge.kind === 'semantic' ? 0.75 : 0.5
    if (edge.kind === 'semantic') {
      context.setLineDash([6 / camera.scale, 4 / camera.scale])
    } else if (edge.kind === 'audit') {
      context.setLineDash([1.5 / camera.scale, 3 / camera.scale])
    } else {
      context.setLineDash([])
      context.lineWidth = (edge.kind === 'calls' ? 0.6 : 1) / camera.scale
    }
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.stroke()
  }
  context.setLineDash([])

  const showLabels = nodes.length <= 150 || camera.scale > 1.5
  const fontSize = Math.max(10 / camera.scale, 4)
  context.font = `${fontSize}px sans-serif`
  for (const node of nodes) {
    const kind = kindsById.get(node.id) ?? 'file'
    context.globalAlpha = dimmed(node.id) ? 0.15 : 1
    context.fillStyle = colors.node[kind]
    context.beginPath()
    context.arc(node.x, node.y, NODE_RADIUS / (kind === 'agent' || kind === 'audit' ? 1 : camera.scale > 1 ? 1 : 1.15), 0, Math.PI * 2)
    context.fill()
    if (node.id === selectedId) {
      context.strokeStyle = colors.selectedRing
      context.lineWidth = 2 / camera.scale
      context.beginPath()
      context.arc(node.x, node.y, NODE_RADIUS + 4 / camera.scale, 0, Math.PI * 2)
      context.stroke()
    }
    if (showLabels) {
      context.fillStyle = colors.dim
      context.globalAlpha = dimmed(node.id) ? 0.1 : 0.85
      const label = kindsById.get(node.id) === 'symbol' ? node.id.split('/').pop() ?? node.id : node.id
      context.fillText(label.slice(0, 42), node.x + NODE_RADIUS + 2 / camera.scale, node.y + fontSize / 3)
    }
  }
  context.globalAlpha = 1
  context.restore()
}
