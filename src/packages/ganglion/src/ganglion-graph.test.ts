import { describe, expect, it } from 'vitest'

import {
  addGanglionEdge,
  addGanglionNode,
  emptyGanglionGraph,
  ganglionAdjacent,
  ganglionEdgeExists,
  ganglionEdgesFrom,
  ganglionEdgesOfKind,
  ganglionEdgesTo,
  type GanglionGraph
} from './ganglion-graph'
import type { GanglionEdge } from './tentacle'

const node = (id: string) => ({ id, tentacle: 'Forge' as const })

const edge = (source: string, target: string, kind: GanglionEdge['kind']): GanglionEdge => ({
  source,
  target,
  kind
})

const graphWithNodes = (...ids: readonly string[]): GanglionGraph =>
  ids.map((id) => node(id)).reduce(addGanglionNode, emptyGanglionGraph())

describe('ganglion-graph', () => {
  it('addGanglionNode never mutates the input graph', () => {
    const empty = emptyGanglionGraph()
    const next = addGanglionNode(empty, node('a'))
    expect(empty.nodes.size).toBe(0)
    expect(next.nodes.size).toBe(1)
    expect(next.edges).toBe(empty.edges)
  })

  it('addGanglionEdge requires both endpoints to be registered nodes', () => {
    const graph = graphWithNodes('a')
    expect(() => addGanglionEdge(graph, edge('a', 'missing', 'serves'))).toThrow(RangeError)
    expect(() => addGanglionEdge(graph, edge('missing', 'a', 'serves'))).toThrow(RangeError)
  })

  it('same (source, target, kind) triples dedupe; differing kind counts as a distinct edge', () => {
    let graph = graphWithNodes('a', 'b')
    graph = addGanglionEdge(graph, edge('a', 'b', 'delegates'))
    const deduped = addGanglionEdge(graph, edge('a', 'b', 'delegates'))
    expect(deduped).toBe(graph)
    expect(ganglionEdgeExists(deduped, edge('a', 'b', 'delegates'))).toBe(true)

    const withObserve = addGanglionEdge(graph, edge('a', 'b', 'observes'))
    expect(withObserve.edges).toHaveLength(2)
  })

  it('edgesFrom / edgesTo / edgesOfKind filter in both directions', () => {
    let graph = graphWithNodes('a', 'b', 'c')
    graph = addGanglionEdge(graph, edge('a', 'b', 'delegates'))
    graph = addGanglionEdge(graph, edge('c', 'a', 'observes'))
    graph = addGanglionEdge(graph, edge('a', 'c', 'serves'))

    expect(ganglionEdgesFrom(graph, 'a').map((item) => item.target)).toEqual(['b', 'c'])
    expect(ganglionEdgesTo(graph, 'a').map((item) => item.source)).toEqual(['c'])
    expect(ganglionEdgesOfKind(graph, 'observes')).toEqual([
      { source: 'c', target: 'a', kind: 'observes' }
    ])
    expect(ganglionEdgesOfKind(graph, 'delegates')).toHaveLength(1)
  })

  it('ganglionAdjacent collects both directions without duplicates', () => {
    let graph = graphWithNodes('a', 'b', 'c')
    graph = addGanglionEdge(graph, edge('a', 'b', 'serves'))
    graph = addGanglionEdge(graph, edge('c', 'a', 'serves'))
    graph = addGanglionEdge(graph, edge('b', 'a', 'serves'))
    expect(ganglionAdjacent(graph, 'a')).toEqual(['b', 'c'])
    expect(ganglionAdjacent(graph, 'c')).toEqual(['a'])
  })
})
