import { describe, expect, it } from 'vitest'

import {
  attachNodeToTentacle,
  createGanglionRegistry,
  ganglionEdgesOutForTentacle,
  ganglionNodeById,
  ganglionNodeIdsForTentacle,
  ganglionTentaclesByName,
  linkRegistryNodes,
  registerTentacle
} from './ganglion-registry'
import { TENTACLE_NAMES, type GanglionNode, type GanglionNodeId, type Tentacle } from './tentacle'

const makeTentacle = (id: string, name: string): Tentacle => ({ id, name, nodes: [] })

const node = (id: GanglionNodeId, tentacle: string): GanglionNode => ({ id, tentacle })

describe('registerTentacle', () => {
  it('accepts exactly the 7 locked brand names', () => {
    expect(TENTACLE_NAMES).toHaveLength(7)
    let registry = createGanglionRegistry()
    for (const name of TENTACLE_NAMES) {
      registry = registerTentacle(registry, makeTentacle(`tentacle:${name.toLowerCase()}`, name))
    }
    expect(registry.tentacles.size).toBe(7)
    expect([...registry.tentacles.values()].map((tentacle) => tentacle.name).sort()).toEqual(
      [...TENTACLE_NAMES].sort()
    )
  })

  it('throws RangeError for an unknown runtime name', () => {
    expect(() =>
      registerTentacle(createGanglionRegistry(), makeTentacle('tentacle:x', 'Octopus-Prime'))
    ).toThrow(RangeError)
    expect(() =>
      registerTentacle(createGanglionRegistry(), makeTentacle('tentacle:x', 'Not-A-Tentacle'))
    ).toThrow(/unknown Tentacle name/)
  })

  it('the vocabulary is case-sensitive: lowercase variants are rejected', () => {
    expect(() =>
      registerTentacle(createGanglionRegistry(), makeTentacle('tentacle:v', 'verifier'))
    ).toThrow(RangeError)
  })

  it('returns a fresh registry: the input registry is not mutated', () => {
    const original = createGanglionRegistry()
    const updated = registerTentacle(original, makeTentacle('tentacle:forge', 'Forge'))
    expect(updated.tentacles.size).toBe(1)
    expect(original.tentacles.size).toBe(0)
  })
})

describe('attachNodeToTentacle', () => {
  it('appends the node id to the tentacle and registers the graph node', () => {
    let registry = registerTentacle(
      createGanglionRegistry(),
      makeTentacle('tentacle:prism', 'Prism')
    )
    registry = attachNodeToTentacle(
      registry,
      'tentacle:prism',
      node('tentacle:prism:node', 'Prism')
    )

    expect(ganglionNodeById(registry, 'tentacle:prism:node')).toEqual({
      id: 'tentacle:prism:node',
      tentacle: 'Prism'
    })
    expect(ganglionNodeIdsForTentacle(registry, 'tentacle:prism')).toEqual(['tentacle:prism:node'])
  })

  it('requires a registered tentacle', () => {
    expect(() =>
      attachNodeToTentacle(createGanglionRegistry(), 'tentacle:ghost', node('n1', 'Forge'))
    ).toThrow(/requires a registered Tentacle/)
  })
})

describe('linkRegistryNodes', () => {
  const buildLinked = () => {
    let registry = createGanglionRegistry()
    for (const name of ['Scaffold', 'Verifier', 'Prism', 'Forge']) {
      const id = `tentacle:${name.toLowerCase()}`
      registry = registerTentacle(registry, makeTentacle(id, name))
      registry = attachNodeToTentacle(registry, id, node(`${id}:node`, name))
    }
    return registry
  }

  it('adds an edge between registered nodes and reports it out of the source', () => {
    const registry = linkRegistryNodes(buildLinked(), {
      source: 'tentacle:scaffold:node',
      target: 'tentacle:verifier:node',
      kind: 'delegates'
    })
    expect(registry.graph.edges).toEqual([
      { source: 'tentacle:scaffold:node', target: 'tentacle:verifier:node', kind: 'delegates' }
    ])
    expect(ganglionEdgesOutForTentacle(registry, 'tentacle:scaffold')).toEqual(registry.graph.edges)
    expect(ganglionEdgesOutForTentacle(registry, 'tentacle:verifier')).toEqual([])
  })

  it('rejects edges touching unregistered nodes', () => {
    expect(() =>
      linkRegistryNodes(createGanglionRegistry(), { source: 'a', target: 'b', kind: 'serves' })
    ).toThrow(RangeError)
  })

  it('re-linking the same edge does not duplicate it', () => {
    const edge = {
      source: 'tentacle:prism:node',
      target: 'tentacle:forge:node',
      kind: 'observes'
    } as const
    const once = linkRegistryNodes(buildLinked(), edge)
    const twice = linkRegistryNodes(once, edge)
    expect(twice.graph.edges).toHaveLength(1)
    expect(twice.graph).toBe(once.graph)
  })
})

describe('lookups', () => {
  const build = () => {
    let registry = createGanglionRegistry()
    for (const name of ['Archivist', 'Inkwell', 'Inkwell']) {
      const id = `tentacle:${name.toLowerCase()}-${registry.tentacles.size}`
      registry = registerTentacle(registry, makeTentacle(id, name))
      registry = attachNodeToTentacle(registry, id, node(`${id}:node`, name))
    }
    return registry
  }

  it('ganglionTentaclesByName filters across duplicate names', () => {
    const registry = build()
    const inkwells = ganglionTentaclesByName(registry, 'Inkwell')
    expect(inkwells).toHaveLength(2)
    expect(ganglionTentaclesByName(registry, 'Archivist')).toHaveLength(1)
    expect(ganglionTentaclesByName(registry, 'Sentinal-7')).toEqual([])
  })

  it('ganglionNodeById returns undefined for unknown ids', () => {
    expect(ganglionNodeById(build(), 'nope')).toBeUndefined()
  })

  it('ganglionNodeIdsForTentacle returns [] for unknown tentacles', () => {
    expect(ganglionNodeIdsForTentacle(build(), 'tentacle:ghost')).toEqual([])
  })
})
