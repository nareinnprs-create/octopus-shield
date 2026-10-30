-- Octopus Shield Brain Atlas — semantic code index (PostgreSQL 16 + pgvector).
-- Run against db `octopusshield` (user `octopus`, host port 5435 per
-- infra/docker-compose.nucleus.yml). Idempotent: safe to re-run.
-- Apply: Get-Content infra/.pg_password | docker exec -i oshn-postgres psql -U octopus -d octopusshield
--
-- Embedding dimensions
-- --------------------
-- Columns are vector(768) to match the default local embedder
-- (@shield/neuro OllamaEmbeddingClient, model nomic-embed-text). The N3.1
-- plan row sketched vector(1536) (OpenAI-class); the dimension is set by the
-- chosen model and enforced by the column type, so swapping models means
-- re-embedding plus ALTER here. The offline dev fallback
-- (HashEmbeddingClient, documented dev-only placeholder) also emits 768 dims.
--
-- Row identity / upsert keys
-- --------------------------
-- - neuro_chunks: UNIQUE (repo_path, kind, symbol). symbol is NOT NULL with
--   '' meaning "file-level chunk"; a nullable symbol would defeat ON
--   CONFLICT because Postgres treats NULLs as distinct. sha is the sha256 of
--   the SOURCE FILE (identical for every chunk of one file revision): the
--   indexer's skip-unchanged test is "a row already exists for
--   (repo_path, sha)". Chunk content itself carries no separate hash; chunk
--   identity is path+kind+symbol.
-- - neuro_symbols: UNIQUE (path, name, line_start).
-- - neuro_links: UNIQUE (src, dst, kind). Only RESOLVED edges are stored —
--   an import that does not resolve to an indexed file has no dst uuid and
--   is dropped. Semantic edges are computed at query time (Atlas-2, N3.5),
--   never persisted. FKs cascade so re-indexing a changed file (DELETE its
--   chunks) also clears its links.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS neuro_chunks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_path  text NOT NULL,
  symbol     text NOT NULL DEFAULT '',
  kind       text NOT NULL CHECK (kind IN ('code', 'markdown', 'json', 'text')),
  content    text NOT NULL,
  embedding  vector(768),
  sha        text NOT NULL CHECK (sha ~ '^[0-9a-f]{64}$'),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT neuro_chunks_identity UNIQUE (repo_path, kind, symbol)
);

CREATE TABLE IF NOT EXISTS neuro_symbols (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path       text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL,
  line_start int  NOT NULL CHECK (line_start >= 1),
  line_end   int  NOT NULL CHECK (line_end >= line_start),
  signature  text NOT NULL DEFAULT '',
  embedding  vector(768),
  CONSTRAINT neuro_symbols_identity UNIQUE (path, name, line_start)
);

CREATE TABLE IF NOT EXISTS neuro_links (
  src      uuid NOT NULL REFERENCES neuro_chunks(id) ON DELETE CASCADE,
  dst      uuid NOT NULL REFERENCES neuro_chunks(id) ON DELETE CASCADE,
  kind     text NOT NULL CHECK (kind IN ('imports', 'calls', 'semantic', 'audit')),
  strength real NOT NULL CHECK (strength >= 0 AND strength <= 1),
  CONSTRAINT neuro_links_identity UNIQUE (src, dst, kind)
);

CREATE INDEX IF NOT EXISTS neuro_chunks_repo_path_idx
  ON neuro_chunks (repo_path);
-- GIN trgm covers prefix/LIKE path filters from Atlas queries; the btree
-- above stays the workhorse for equality (skip check, link dst lookups).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS neuro_chunks_repo_path_trgm_idx
  ON neuro_chunks USING gin (repo_path gin_trgm_ops);
-- HNSW cosine serves the <=> top-K path; ivfflat was skipped because HNSW
-- needs no training rows and keeps recall on small corpora like this one.
CREATE INDEX IF NOT EXISTS neuro_chunks_embedding_hnsw_idx
  ON neuro_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS neuro_symbols_path_idx ON neuro_symbols (path);
CREATE INDEX IF NOT EXISTS neuro_symbols_name_idx ON neuro_symbols (name);
CREATE INDEX IF NOT EXISTS neuro_symbols_embedding_hnsw_idx
  ON neuro_symbols USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS neuro_links_src_idx ON neuro_links (src);
CREATE INDEX IF NOT EXISTS neuro_links_dst_idx ON neuro_links (dst);

COMMENT ON TABLE neuro_chunks IS
  'Brain Atlas semantic index: structure-aware chunks of indexed repo files. embedding is 768-dim (nomic-embed-text); sha is the sha256 of the source FILE so the indexer can skip unchanged paths.';
COMMENT ON COLUMN neuro_chunks.symbol IS
  'Declaration name the chunk was split on; '''' = file-level chunk (prelude, windowed or whole-file content).';
COMMENT ON TABLE neuro_symbols IS
  'Brain Atlas symbol table: functions/classes/types/interfaces/headings with line ranges and a 768-dim embedding of the signature line.';
COMMENT ON TABLE neuro_links IS
  'Directed chunk-to-chunk edges. Only resolved import edges are persisted (strength 1); semantic/audit edges are written by later stages, query-time semantic similarity is NOT stored here.';

GRANT SELECT, INSERT, UPDATE, DELETE ON neuro_chunks, neuro_symbols, neuro_links TO octopus;

COMMIT;
