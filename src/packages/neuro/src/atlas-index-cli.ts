/**
 * Dev/validation CLI for the Brain Atlas (not a shipped export).
 * Index:   pnpm --filter @shield/neuro exec tsx src/atlas-index-cli.ts <dir-inside-repo>
 * Query:   pnpm --filter @shield/neuro exec tsx src/atlas-index-cli.ts <dir> --query "text"
 * Embedder: OSH_NEURO_EMBEDDER=ollama switches to Ollama; default is the
 * documented dev-only HashEmbeddingClient so the pipeline runs offline.
 */
import { resolve, relative, sep } from 'node:path'

import {
  AtlasIndexer,
  AtlasQuery,
  createNeuroPgClient,
  HashEmbeddingClient,
  OllamaEmbeddingClient,
  withEmbedRetry,
  type EmbeddingClient
} from './index'

const REPO_ROOT = resolve(__dirname, '../../../..')

const queryFlagIndex = process.argv.indexOf('--query')
const queryText = queryFlagIndex === -1 ? null : process.argv[queryFlagIndex + 1]
const targetArg = process.argv[2]

if (!targetArg) {
  console.error('usage: tsx src/atlas-index-cli.ts <dir-inside-repo> [--query "text"]')
  process.exit(1)
}

const targetRoot = resolve(process.cwd(), targetArg)
const repoPrefix = relative(REPO_ROOT, targetRoot).split(sep).join('/')

function pickEmbedder(): EmbeddingClient {
  if (process.env.OSH_NEURO_EMBEDDER === 'ollama') {
    return new OllamaEmbeddingClient({
      host: process.env.OSH_NEURO_OLLAMA_HOST,
      model: process.env.OSH_NEURO_OLLAMA_MODEL
    })
  }
  return new HashEmbeddingClient()
}

async function main(): Promise<void> {
  const handle = createNeuroPgClient({
    host: process.env.OSH_PG_HOST ?? '127.0.0.1',
    port: Number(process.env.OSH_PG_PORT ?? 5435),
    database: process.env.OSH_PG_DB ?? 'octopusshield',
    user: process.env.OSH_PG_USER ?? 'octopus',
    passwordFile: process.env.OSH_PG_PASSWORD_FILE ?? resolve(REPO_ROOT, 'infra/.pg_password')
  })
  try {
    if (queryText === null) {
      const indexer = new AtlasIndexer({
        root: targetRoot,
        repoPrefix,
        client: handle.client,
        embedder: withEmbedRetry(pickEmbedder())
      })
      const report = await indexer.indexRepo()
      console.log(JSON.stringify(report, null, 2))
    } else {
      const query = new AtlasQuery(handle.client, pickEmbedder())
      const hits = await query.semantic(queryText, { limit: 8, pathPrefix: repoPrefix })
      for (const hit of hits) {
        console.log(
          `${hit.distance.toFixed(4)}  ${hit.repoPath}${hit.symbol ? ` :: ${hit.symbol}` : ''}`
        )
      }
    }
  } finally {
    await handle.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
