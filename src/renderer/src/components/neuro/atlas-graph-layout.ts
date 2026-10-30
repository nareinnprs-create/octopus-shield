// Pure Brain Atlas graph math: force simulation, directory clustering, node culling.
// Mutating sim nodes is deliberate — new arrays per 60fps tick would only churn GC.

export type AtlasSimNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export type AtlasSimEdge = {
  source: string
  target: string
}

export type AtlasClusterNode = {
  id: string
  path?: string
}

export const REPULSION_CUTOFF = 260
export const SPRING_LENGTH = 90

/** Seed a spiral of new ids; keep the previous position of nodes already on screen. */
export function createSimNodes(
  ids: readonly string[],
  previous?: ReadonlyMap<string, AtlasSimNode>
): AtlasSimNode[] {
  let seeded = 0
  return ids.map((id) => {
    const known = previous?.get(id)
    if (known) {
      return { ...known }
    }
    // Sunflower spiral spreads fresh nodes without overlaps.
    const radius = 26 * Math.sqrt(seeded + 1)
    const angle = seeded * 2.399963
    seeded += 1
    return { id, x: radius * Math.cos(angle), y: radius * Math.sin(angle), vx: 0, vy: 0 }
  })
}

/** One velocity-Verlet-ish step: pairwise repulsion, edge springs, center gravity. */
export function stepSimulation(
  nodes: readonly AtlasSimNode[],
  edges: readonly AtlasSimEdge[],
  alpha: number,
  springLength = SPRING_LENGTH
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i] as AtlasSimNode
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j] as AtlasSimNode
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared > REPULSION_CUTOFF * REPULSION_CUTOFF || distanceSquared === 0) {
        continue
      }
      const repulsion = (alpha * 1200) / distanceSquared
      const distance = Math.sqrt(distanceSquared)
      const fx = (dx / distance) * repulsion
      const fy = (dy / distance) * repulsion
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
  }
  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) {
      continue
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const distance = Math.sqrt(dx * dx + dy * dy) || 1
    const pull = (alpha * (distance - springLength)) / distance
    a.vx += dx * pull
    a.vy += dy * pull
    b.vx -= dx * pull
    b.vy -= dy * pull
  }
  for (const node of nodes) {
    node.vx -= node.x * alpha * 0.015
    node.vy -= node.y * alpha * 0.015
    node.vx *= 0.85
    node.vy *= 0.85
    node.x += node.vx
    node.y += node.vy
  }
}

/** Alpha cools as motion settles; caller re-heats on graph change. */
export function nextAlpha(alpha: number, nodes: readonly AtlasSimNode[]): number {
  const motion = nodes.reduce((sum, node) => sum + Math.abs(node.vx) + Math.abs(node.vy), 0)
  if (motion / Math.max(nodes.length, 1) < 0.05) {
    return 0
  }
  return Math.max(0, alpha * 0.97)
}

/** Keep agent/audit nodes plus the highest-degree files/symbols up to `cap`; drop dangling edges. */
export function cullGraph<K extends { id: string; kind: string }, E extends { source: string; target: string }>(
  nodes: readonly K[],
  edges: readonly E[],
  cap: number
): { nodes: K[]; edges: E[] } {
  if (nodes.length <= cap) {
    return { nodes: [...nodes], edges: [...edges] }
  }
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const pinned = nodes.filter((node) => node.kind === 'agent' || node.kind === 'audit')
  const ranked = nodes
    .filter((node) => node.kind !== 'agent' && node.kind !== 'audit')
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
  const keptIds = new Set([...pinned, ...ranked.slice(0, Math.max(0, cap - pinned.length))].map((n) => n.id))
  return {
    nodes: nodes.filter((node) => keptIds.has(node.id)),
    edges: edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
  }
}

const directoryOf = (path: string | undefined, id: string): string => {
  const normalized = (path ?? id).replace(/\\/g, '/')
  const cut = normalized.lastIndexOf('/')
  return cut === -1 ? '' : normalized.slice(0, cut)
}

/** Snap nodes into per-directory clusters laid on a ring (cluster-by-directory toggle). */
export function directoryClusterPositions(
  nodes: readonly AtlasClusterNode[],
  spread = 140
): Map<string, { x: number; y: number }> {
  const clusters = new Map<string, string[]>()
  for (const node of nodes) {
    const dir = directoryOf(node.path, node.id)
    const members = clusters.get(dir)
    if (members) {
      members.push(node.id)
    } else {
      clusters.set(dir, [node.id])
    }
  }
  const positions = new Map<string, { x: number; y: number }>()
  const clusterDirs = [...clusters.keys()]
  for (const [clusterIndex, dir] of clusterDirs.entries()) {
    const members = clusters.get(dir) ?? []
    const clusterAngle = (clusterIndex / Math.max(clusterDirs.length, 1)) * Math.PI * 2
    const center = {
      x: Math.cos(clusterAngle) * spread * Math.sqrt(clusterDirs.length),
      y: Math.sin(clusterAngle) * spread * Math.sqrt(clusterDirs.length)
    }
    members.forEach((id, memberIndex) => {
      const angle = (memberIndex / members.length) * Math.PI * 2
      positions.set(id, {
        x: center.x + Math.cos(angle) * 34 * Math.sqrt(members.length),
        y: center.y + Math.sin(angle) * 34 * Math.sqrt(members.length)
      })
    })
  }
  return positions
}

export function hitTestNode(
  nodes: readonly AtlasSimNode[],
  x: number,
  y: number,
  radius: number
): AtlasSimNode | null {
  let closest: AtlasSimNode | null = null
  let closestDistance = radius
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y)
    if (distance <= closestDistance) {
      closest = node
      closestDistance = distance
    }
  }
  return closest
}
