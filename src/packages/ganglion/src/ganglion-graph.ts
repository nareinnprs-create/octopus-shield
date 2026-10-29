import type { GanglionEdge, GanglionEdgeKind, GanglionNode, GanglionNodeId } from './tentacle'

/** Value graph; every function below returns a fresh graph instead of mutating. */
export type GanglionGraph = {
  readonly nodes: ReadonlyMap<GanglionNodeId, GanglionNode>
  readonly edges: readonly GanglionEdge[]
}

export const emptyGanglionGraph = (): GanglionGraph => ({ nodes: new Map(), edges: [] })

export const addGanglionNode = (graph: GanglionGraph, node: GanglionNode): GanglionGraph => {
  const nodes = new Map(graph.nodes)
  nodes.set(node.id, node)
  return { nodes, edges: graph.edges }
}

export const addGanglionEdge = (graph: GanglionGraph, edge: GanglionEdge): GanglionGraph => {
  if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
    throw new RangeError(
      `Ganglion edge endpoints must be registered nodes: ${edge.source} -> ${edge.target}`
    )
  }
  if (graph.edges.some((existing) => sameEdge(existing, edge))) {
    return graph
  }
  return { nodes: graph.nodes, edges: [...graph.edges, edge] }
}

const sameEdge = (left: GanglionEdge, right: GanglionEdge): boolean =>
  left.source === right.source && left.target === right.target && left.kind === right.kind

export const ganglionEdgeExists = (graph: GanglionGraph, edge: GanglionEdge): boolean =>
  graph.edges.some((existing) => sameEdge(existing, edge))

export const ganglionEdgesFrom = (
  graph: GanglionGraph,
  nodeId: GanglionNodeId
): readonly GanglionEdge[] => graph.edges.filter((edge) => edge.source === nodeId)

export const ganglionEdgesTo = (
  graph: GanglionGraph,
  nodeId: GanglionNodeId
): readonly GanglionEdge[] => graph.edges.filter((edge) => edge.target === nodeId)

export const ganglionEdgesOfKind = (
  graph: GanglionGraph,
  kind: GanglionEdgeKind
): readonly GanglionEdge[] => graph.edges.filter((edge) => edge.kind === kind)

export const ganglionAdjacent = (
  graph: GanglionGraph,
  nodeId: GanglionNodeId
): readonly GanglionNodeId[] => {
  const adjacent: GanglionNodeId[] = []
  for (const edge of graph.edges) {
    if (edge.source === nodeId && !adjacent.includes(edge.target)) {
      adjacent.push(edge.target)
    }
    if (edge.target === nodeId && !adjacent.includes(edge.source)) {
      adjacent.push(edge.source)
    }
  }
  return adjacent
}
