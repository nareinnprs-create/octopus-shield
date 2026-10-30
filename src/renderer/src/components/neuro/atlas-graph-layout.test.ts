import { describe, expect, it } from 'vitest'
import {
  createSimNodes,
  cullGraph,
  directoryClusterPositions,
  hitTestNode,
  nextAlpha,
  stepSimulation
} from './atlas-graph-layout'

describe('atlas graph layout', () => {
  it('seeds deterministic spiral positions and preserves known nodes', () => {
    const first = createSimNodes(['a', 'b'])
    expect(first[0]).toMatchObject({ id: 'a', x: 26, y: 0 })
    expect(first[0]?.x).not.toBe(first[1]?.x)
    const previous = new Map(first.map((node) => [node.id, node]))
    const [kept] = createSimNodes(['a', 'c'], previous)
    expect(kept).toMatchObject({ id: 'a', x: first[0]?.x, y: first[0]?.y })
  })

  it('pulls linked nodes together and cools to rest', () => {
    const nodes = createSimNodes(['a', 'b'])
    if (!nodes[0] || !nodes[1]) {
      throw new Error('missing nodes')
    }
    nodes[0].x = -400
    nodes[1].x = 400
    const edges = [{ source: 'a', target: 'b' }]
    const initialDistance = Math.abs(nodes[1].x - nodes[0].x)
    let alpha = 0.8
    for (let tick = 0; tick < 200 && alpha > 0; tick++) {
      stepSimulation(nodes, edges, alpha)
      alpha = nextAlpha(alpha, nodes)
    }
    const finalDistance = Math.abs(nodes[1].x - nodes[0].x)
    expect(finalDistance).toBeLessThan(initialDistance / 4)
    expect(finalDistance).toBeGreaterThan(0)
    expect(alpha).toBe(0)
  })

  it('caps the graph at the visible-node budget keeping pinned kinds and induced edges', () => {
    const nodes = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, kind: 'file' })),
      { id: 'agent-1', kind: 'agent' },
      { id: 'audit-1', kind: 'audit' }
    ]
    const edges = [
      { source: 'f0', target: 'f5' }, // f0 highest degree (2)
      { source: 'f0', target: 'f1' },
      { source: 'f1', target: 'f2' },
      { source: 'f2', target: 'f3' },
      { source: 'agent-1', target: 'f4' },
      { source: 'audit-1', target: 'f5' }
    ]
    const capped = cullGraph(nodes, edges, 4)
    const ids = new Set(capped.nodes.map((node) => node.id))
    expect(capped.nodes).toHaveLength(4)
    expect(ids.has('agent-1')).toBe(true)
    expect(ids.has('audit-1')).toBe(true)
    for (const edge of capped.edges) {
      expect(ids.has(edge.source)).toBe(true)
      expect(ids.has(edge.target)).toBe(true)
    }
    expect(capped.edges.some((edge) => edge.source === 'f0')).toBe(true)
  })

  it('clusters same-directory nodes near each other', () => {
    const nodes = [
      { id: 'a1', path: 'src/auth/login.ts' },
      { id: 'a2', path: 'src/auth/logout.ts' },
      { id: 'b1', path: 'docs/readme.md' }
    ]
    const positions = directoryClusterPositions(nodes)
    const a1 = positions.get('a1')
    const a2 = positions.get('a2')
    const b1 = positions.get('b1')
    if (!a1 || !a2 || !b1) {
      throw new Error('missing positions')
    }
    expect(Math.hypot(a1.x - a2.x, a1.y - a2.y)).toBeLessThan(Math.hypot(a1.x - b1.x, a1.y - b1.y))
  })

  it('hit tests the nearest node within radius', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 30, y: 0, vx: 0, vy: 0 }
    ]
    expect(hitTestNode(nodes, 2, 1, 5)?.id).toBe('a')
    expect(hitTestNode(nodes, 28, 0, 5)?.id).toBe('b')
    expect(hitTestNode(nodes, 15, 100, 5)).toBeNull()
  })
})
