import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AtlasEdgeKind,
  AtlasGraphSnapshot,
  AtlasNode,
  AtlasNodeKind,
  AtlasSemanticMatch,
  AtlasStatus
} from '../../../../shared/neuro-atlas-contract'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AtlasNodeDetail, { blendRelated, type RelatedEntry } from './AtlasNodeDetail'
import {
  cullGraph,
  createSimNodes,
  directoryClusterPositions,
  nextAlpha,
  stepSimulation,
  type AtlasSimEdge,
  type AtlasSimNode
} from './atlas-graph-layout'
import { cssColor, drawScene, type AtlasCamera, edgeColorToken, kindColorToken } from './atlas-graph-canvas'
import { useAtlasCamera } from './use-atlas-camera'

const POLL_INTERVAL_MS = 2_000
const MAX_VISIBLE_NODES = 500
const REHEAT_ALPHA = 0.8

export default function AtlasGraph(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AtlasGraphSnapshot | null>(null)
  const [status, setStatus] = useState<AtlasStatus | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<readonly AtlasSemanticMatch[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clusterByDirectory, setClusterByDirectory] = useState(false)
  const [related, setRelated] = useState<readonly RelatedEntry[]>([])
  const [detailMatches, setDetailMatches] = useState<readonly AtlasSemanticMatch[]>([])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const simNodesRef = useRef<AtlasSimNode[]>([])
  const simEdgesRef = useRef<(AtlasSimEdge & { kind: AtlasEdgeKind })[]>([])
  const kindsRef = useRef<Map<string, AtlasNodeKind>>(new Map())
  const labelsRef = useRef<Map<string, AtlasNode>>(new Map())
  const cameraRef = useRef<AtlasCamera>({ x: 0, y: 0, scale: 1 })
  const alphaRef = useRef(0)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId

  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      const api = window.api?.neuroAtlas
      if (!api) {
        return
      }
      void api
        .graph({ limit: MAX_VISIBLE_NODES })
        .then((next) => {
          if (cancelled) {
            return
          }
          setSnapshot(next)
          setGraphError(null)
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setGraphError(error instanceof Error ? error.message : String(error))
          }
        })
      void api
        .status()
        .then((next) => {
          if (!cancelled) {
            setStatus(next)
          }
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // Merge polled snapshots into the simulation, preserving positions of known nodes.
  useEffect(() => {
    if (!snapshot) {
      return
    }
    const { nodes: keptNodes, edges: keptEdges } = cullGraph(
      [...snapshot.nodes],
      [...snapshot.edges],
      MAX_VISIBLE_NODES
    )
    const previous = new Map(simNodesRef.current.map((node) => [node.id, node]))
    const merged = createSimNodes(
      keptNodes.map((node) => node.id),
      previous
    )
    if (clusterByDirectory) {
      const clustered = directoryClusterPositions(keptNodes)
      for (const node of merged) {
        const position = clustered.get(node.id)
        if (position) {
          node.x = position.x
          node.y = position.y
          node.vx = 0
          node.vy = 0
        }
      }
    }
    simNodesRef.current = merged
    simEdgesRef.current = keptEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind
    }))
    kindsRef.current = new Map(keptNodes.map((node) => [node.id, node.kind]))
    labelsRef.current = new Map(keptNodes.map((node) => [node.id, node]))
    alphaRef.current = Math.max(alphaRef.current, REHEAT_ALPHA)
  }, [snapshot, clusterByDirectory])

  // Render loop: physics step + draw; alpha cools to zero so idle CPU is nil.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    let raf = 0
    const frame = (): void => {
      if (alphaRef.current > 0) {
        stepSimulation(simNodesRef.current, simEdgesRef.current, alphaRef.current)
        alphaRef.current = nextAlpha(alphaRef.current, simNodesRef.current)
      }
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        const dpr = window.devicePixelRatio || 1
        const width = Math.round(canvas.clientWidth * dpr)
        const height = Math.round(canvas.clientHeight * dpr)
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        drawScene(
          canvas,
          simNodesRef.current,
          simEdgesRef.current,
          kindsRef.current,
          cameraRef.current,
          {
            node: {
              file: cssColor(canvas, kindColorToken.file),
              symbol: cssColor(canvas, kindColorToken.symbol),
              agent: cssColor(canvas, kindColorToken.agent),
              audit: cssColor(canvas, kindColorToken.audit)
            },
            edge: {
              imports: cssColor(canvas, edgeColorToken.imports),
              calls: cssColor(canvas, edgeColorToken.calls),
              semantic: cssColor(canvas, edgeColorToken.semantic),
              audit: cssColor(canvas, edgeColorToken.audit)
            },
            dim: cssColor(canvas, ['--muted-foreground', '#737373']),
            selectedRing: cssColor(canvas, ['--foreground', '#171717'])
          },
          selectedRef.current
        )
      }
      raf = window.requestAnimationFrame(frame)
    }
    raf = window.requestAnimationFrame(frame)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  const { centerOnNode } = useAtlasCamera({
    canvasRef,
    cameraRef,
    simNodesRef,
    onSelectNode: setSelectedId
  })

  // Node detail: link count + semantic matches + blended related.
  const selectedNode = useMemo(
    () => (selectedId ? (snapshot?.nodes.find((node) => node.id === selectedId) ?? null) : null),
    [selectedId, snapshot]
  )
  const selectedLinkCount = useMemo(() => {
    if (!selectedId) {
      return 0
    }
    return (snapshot?.edges ?? []).filter(
      (edge) => edge.source === selectedId || edge.target === selectedId
    ).length
  }, [selectedId, snapshot])

  useEffect(() => {
    if (!selectedNode) {
      setRelated([])
      setDetailMatches([])
      return
    }
    let cancelled = false
    const api = window.api?.neuroAtlas
    void (api
      ? api
          .semantic({ text: selectedNode.label, limit: 5 })
          .then((matches) => {
            if (!cancelled) {
              setDetailMatches(matches)
              setRelated(blendRelated(selectedNode, snapshot ?? { nodes: [], edges: [], generatedAtEpochMs: 0 }, matches))
            }
          })
          .catch(() => {
            if (!cancelled) {
              setDetailMatches([])
              setRelated(blendRelated(selectedNode, snapshot ?? { nodes: [], edges: [], generatedAtEpochMs: 0 }, []))
            }
          })
      : undefined)
    return () => {
      cancelled = true
    }
  }, [selectedNode, snapshot])

  const runSearch = useCallback(async (): Promise<void> => {
    const api = window.api?.neuroAtlas
    if (!api || searching) {
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await api.semantic({ text: query.trim(), limit: 20 }))
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
      setResults(null)
    } finally {
      setSearching(false)
    }
  }, [query, searching])

  const onSelectResult = useCallback(
    (match: AtlasSemanticMatch): void => {
      setSelectedId(match.id)
      centerOnNode(match.id)
    },
    [centerOnNode]
  )

  const nodes = snapshot?.nodes ?? []

  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header className="flex shrink-0 items-center gap-3 px-3 pb-3 md:px-5">
        <h1 className="truncate text-base font-semibold leading-8">
          {translate('auto.components.neuro.AtlasGraph.title', 'Brain Atlas')}
        </h1>
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {translate(
            'auto.components.neuro.AtlasGraph.subtitle',
            'Semantic code graph — files, symbols, agents, audits'
          )}
        </span>
        {status ? (
          <span
            className="ml-auto rounded-full border border-border px-2 py-0.5 text-2xs uppercase tracking-wider text-muted-foreground"
            data-testid="atlas-status"
          >
            {translate('auto.components.neuro.AtlasGraph.state', status.state)}
            {typeof status.fileCount === 'number' ? ` · ${status.fileCount}` : ''}
          </span>
        ) : null}
      </header>

      {graphError ? (
        <div className="mx-3 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive md:mx-5">
          {graphError}
        </div>
      ) : null}

      <div className="mx-3 mb-3 flex items-center gap-2 md:mx-5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim().length > 0) {
              void runSearch()
            }
          }}
          placeholder={translate(
            'auto.components.neuro.AtlasGraph.searchPlaceholder',
            'Ask the atlas — e.g. "where is auth handled"'
          )}
          className="max-w-md"
          aria-label={translate('auto.components.neuro.AtlasGraph.search', 'Semantic search')}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void runSearch()}
          disabled={searching || query.trim().length === 0}
        >
          {searching
            ? translate('auto.components.neuro.AtlasGraph.searching', 'Searching…')
            : translate('auto.components.neuro.AtlasGraph.search', 'Search')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={clusterByDirectory ? 'default' : 'outline'}
          aria-pressed={clusterByDirectory}
          onClick={() => setClusterByDirectory((value) => !value)}
        >
          {translate('auto.components.neuro.AtlasGraph.cluster', 'Cluster by directory')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 px-3 pb-5 md:px-5">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-border">
          <canvas ref={canvasRef} className="h-full w-full touch-none" role="img" aria-label={translate('auto.components.neuro.AtlasGraph.canvasLabel', 'Atlas graph')} />
          {snapshot === null ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" data-testid="atlas-loading">
              {translate('auto.components.neuro.AtlasGraph.loading', 'Loading atlas…')}
            </div>
          ) : null}
          {snapshot !== null && nodes.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" data-testid="atlas-empty">
              {translate(
                'auto.components.neuro.AtlasGraph.empty',
                'Atlas is empty — index a workspace to see its graph.'
              )}
            </div>
          ) : null}
        </div>

        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-auto border-border pl-3">
          {results ? (
            <section aria-label={translate('auto.components.neuro.AtlasGraph.results', 'Semantic results')}>
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {translate('auto.components.neuro.AtlasGraph.results', 'Semantic results')}
              </h2>
              {results.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  {translate('auto.components.neuro.AtlasGraph.noResults', 'No matches indexed yet.')}
                </p>
              ) : (
                <ul className="grid gap-1">
                  {results.map((match) => (
                    <li key={match.id}>
                      <button
                        type="button"
                        onClick={() => onSelectResult(match)}
                        className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                      >
                        <span className="block truncate font-medium">{match.label}</span>
                        <span className="block truncate text-muted-foreground">
                          {match.path ?? match.id} · {match.score.toFixed(2)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {searchError ? (
            <p className="text-xs text-destructive" role="alert">
              {searchError}
            </p>
          ) : null}

          {selectedNode ? (
            <AtlasNodeDetail
              node={selectedNode}
              linkCount={selectedLinkCount}
              related={related}
              semanticCount={detailMatches.length}
              onSelectResult={onSelectResult}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.neuro.AtlasGraph.clickHint',
                'Click a node for details. Drag to pan, scroll to zoom.'
              )}
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}
