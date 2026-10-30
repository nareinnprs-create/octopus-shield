import type {
  AtlasEdgeKind,
  AtlasGraphSnapshot,
  AtlasNode,
  AtlasSemanticMatch
} from '../../../../shared/neuro-atlas-contract'
import { translate } from '@/i18n/i18n'

export type RelatedEntry = { id: string; label: string; path?: string; score: number; via: AtlasEdgeKind | 'semantic' }

/** Graph edges plus semantic matches for one node, best score first, capped at five. */
export function blendRelated(
  node: AtlasNode,
  snapshot: AtlasGraphSnapshot,
  semantic: readonly AtlasSemanticMatch[]
): RelatedEntry[] {
  const blended = new Map<string, RelatedEntry>()
  for (const edge of snapshot.edges) {
    const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null
    if (otherId === null) {
      continue
    }
    const other = snapshot.nodes.find((candidate) => candidate.id === otherId)
    if (!other) {
      continue
    }
    blended.set(otherId, {
      id: otherId,
      label: other.label,
      path: other.path,
      score: edge.strength,
      via: edge.kind
    })
  }
  for (const match of semantic) {
    if (match.id === node.id) {
      continue
    }
    const existing = blended.get(match.id)
    if (!existing || existing.score < match.score) {
      blended.set(match.id, {
        id: match.id,
        label: match.label,
        path: match.path,
        score: match.score,
        via: 'semantic'
      })
    }
  }
  return [...blended.values()].sort((a, b) => b.score - a.score).slice(0, 5)
}

const kindLabel = (kind: string): string =>
  translate(`auto.components.neuro.AtlasGraph.kind.${kind}`, kind)

type AtlasNodeDetailProps = {
  node: AtlasNode
  linkCount: number
  related: readonly RelatedEntry[]
  semanticCount: number
  onSelectResult: (match: AtlasSemanticMatch) => void
}

export default function AtlasNodeDetail({
  node,
  linkCount,
  related,
  semanticCount,
  onSelectResult
}: AtlasNodeDetailProps): React.JSX.Element {
  return (
    <section aria-label={translate('auto.components.neuro.AtlasGraph.details', 'Node details')} data-testid="atlas-detail">
      <h2 className="mb-1 truncate text-sm font-semibold">{node.label}</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        {kindLabel(node.kind)}
        {node.path ? ` · ${node.path}` : ''} ·{' '}
        {translate('auto.components.neuro.AtlasGraph.links', 'links')}:
        {' '}
        {linkCount}
      </p>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {translate('auto.components.neuro.AtlasGraph.related', 'Related')}
      </h3>
      {related.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">
          {translate('auto.components.neuro.AtlasGraph.noRelated', 'No related links.')}
        </p>
      ) : (
        <ul className="grid gap-1">
          {related.map((entry) => (
            <li key={`${entry.via}:${entry.id}`}>
              <button
                type="button"
                onClick={() => onSelectResult({ id: entry.id, kind: 'file', label: entry.label, path: entry.path, score: entry.score })}
                className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
              >
                <span className="block truncate font-medium">{entry.label}</span>
                <span className="block truncate text-muted-foreground">
                  {entry.via} · {entry.score.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {semanticCount > 0 ? (
        <p className="mt-2 text-2xs text-muted-foreground">
          {translate(
            'auto.components.neuro.AtlasGraph.semanticNote',
            `${semanticCount} semantic matches for this node`
          )}
        </p>
      ) : null}
    </section>
  )
}
