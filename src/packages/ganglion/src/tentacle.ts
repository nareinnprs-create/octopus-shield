export const TENTACLE_NAMES = [
  'Archivist',
  'Scaffold',
  'Forge',
  'Inkwell',
  'Prism',
  'Sentinal-7',
  'Verifier'
] as const

export type TentacleName = (typeof TENTACLE_NAMES)[number] | (string & {})

export type TentacleId = string

export type GanglionNodeId = string

/** Closed for now; extend when the Ganglion protocol needs more relationships. */
export type GanglionEdgeKind = 'delegates' | 'observes' | 'serves'

export type GanglionNode = {
  id: GanglionNodeId
  /** Tentacle sub-team this graph position belongs to. */
  tentacle: TentacleName
  label?: string
}

export type GanglionEdge = {
  source: GanglionNodeId
  target: GanglionNodeId
  kind: GanglionEdgeKind
}

export type Tentacle = {
  id: TentacleId
  name: TentacleName
  nodes: readonly GanglionNodeId[]
}

export const isKnownTentacleName = (name: string): boolean =>
  (TENTACLE_NAMES as readonly string[]).includes(name)
