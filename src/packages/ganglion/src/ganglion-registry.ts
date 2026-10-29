import {
  addGanglionEdge,
  addGanglionNode,
  emptyGanglionGraph,
  ganglionEdgesFrom,
  type GanglionGraph
} from './ganglion-graph'
import type {
  GanglionEdge,
  GanglionNode,
  GanglionNodeId,
  Tentacle,
  TentacleId,
  TentacleName
} from './tentacle'
import { isKnownTentacleName, TENTACLE_NAMES } from './tentacle'

/** Registry of Tentacle sub-teams over a Ganglion graph; still pure data + functions. */
export type GanglionRegistry = {
  readonly graph: GanglionGraph
  readonly tentacles: ReadonlyMap<TentacleId, Tentacle>
}

export const createGanglionRegistry = (): GanglionRegistry => ({
  graph: emptyGanglionGraph(),
  tentacles: new Map()
})

export const registerTentacle = (
  registry: GanglionRegistry,
  tentacle: Tentacle
): GanglionRegistry => {
  // The 7 Tentacle names are the locked brand vocabulary (INFRA: rbac.sql
  // seeds the same 7 principals); the open string type is for future
  // extension, unknown runtime names must not enter the registry silently.
  if (!isKnownTentacleName(tentacle.name)) {
    throw new RangeError(`unknown Tentacle name: ${tentacle.name}`)
  }
  const tentacles = new Map(registry.tentacles)
  tentacles.set(tentacle.id, tentacle)
  return { graph: registry.graph, tentacles }
}

export const attachNodeToTentacle = (
  registry: GanglionRegistry,
  tentacleId: TentacleId,
  node: GanglionNode
): GanglionRegistry => {
  const tentacle = registry.tentacles.get(tentacleId)
  if (!tentacle) {
    throw new RangeError(`Annex node requires a registered Tentacle: ${tentacleId}`)
  }
  const updated: Tentacle = { ...tentacle, nodes: [...tentacle.nodes, node.id] }
  const tentacles = new Map(registry.tentacles)
  tentacles.set(tentacle.id, updated)
  return { graph: addGanglionNode(registry.graph, node), tentacles }
}

export const linkRegistryNodes = (
  registry: GanglionRegistry,
  edge: GanglionEdge
): GanglionRegistry => ({
  graph: addGanglionEdge(registry.graph, edge),
  tentacles: registry.tentacles
})

export const ganglionNodeById = (registry: GanglionRegistry, nodeId: GanglionNodeId) =>
  registry.graph.nodes.get(nodeId)

export const ganglionTentaclesByName = (
  registry: GanglionRegistry,
  name: TentacleName
): readonly Tentacle[] =>
  [...registry.tentacles.values()].filter((tentacle) => tentacle.name === name)

export const ganglionNodeIdsForTentacle = (
  registry: GanglionRegistry,
  tentacleId: TentacleId
): readonly GanglionNodeId[] => registry.tentacles.get(tentacleId)?.nodes ?? []

export const ganglionEdgesOutForTentacle = (
  registry: GanglionRegistry,
  tentacleId: TentacleId
): readonly GanglionEdge[] =>
  ganglionNodeIdsForTentacle(registry, tentacleId).flatMap((nodeId) =>
    ganglionEdgesFrom(registry.graph, nodeId)
  )

/** The 7 locked Tentacles, one primary node each — the composition base for hosts. */
export const seedDefaultGanglionRegistry = (): GanglionRegistry => {
  let registry = createGanglionRegistry()
  for (const name of TENTACLE_NAMES) {
    const tentacleId = `tentacle:${name.toLowerCase()}`
    registry = registerTentacle(registry, { id: tentacleId, name, nodes: [] })
    registry = attachNodeToTentacle(registry, tentacleId, {
      id: `${tentacleId}:node`,
      tentacle: name
    })
  }
  return registry
}
