PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;              -- CACHE_SCHEMA_VERSION

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,             -- 'cacheSchemaVersion' | 'engineVersion'
                                      -- | 'grammarFingerprint' | 'contractSchemaVersion'
  value TEXT NOT NULL
);

CREATE TABLE file_cache (
  path           TEXT PRIMARY KEY,    -- repo-relative POSIX, e.g. 'src/api/user.ts'
  content_hash   TEXT NOT NULL,       -- sha256 of raw bytes, lowercase hex
  size_bytes     INTEGER NOT NULL,
  line_count     INTEGER NOT NULL,
  language       TEXT NOT NULL,       -- 'ts'|'tsx'|'js'|'jsx'|'py'|'json'|'md'|'other'
  classification TEXT NOT NULL,       -- FileClassification enum, Section 8.6
  is_parsed      INTEGER NOT NULL,    -- 0 = skipped (binary/too large/minified)
  skip_reason    TEXT,                -- null when is_parsed = 1
  parsed_json    TEXT NOT NULL        -- ParsedFile JSON: raw imports + symbols + tokens
);
CREATE INDEX idx_file_cache_hash ON file_cache(content_hash);
-- Reason: incremental re-analysis compares stored hash to freshly computed hash in one
-- indexed lookup per file; without it the warm-run budget (Section 10) is unreachable.
CREATE INDEX idx_file_cache_lang ON file_cache(language);
-- Reason: the parser pool batches work per language to avoid reloading WASM grammars.

CREATE TABLE symbol (
  id            TEXT PRIMARY KEY,     -- sha1(path + '#' + name + '#' + startLine)[:16]
  path          TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- function|class|method|const|type|interface|enum
                                      -- |variable|component|hook|route
  start_line    INTEGER NOT NULL,     -- 1-based, inclusive
  end_line      INTEGER NOT NULL,     -- 1-based, inclusive
  is_exported   INTEGER NOT NULL,
  container     TEXT,                 -- enclosing class/function name, null at top level
  signature     TEXT                  -- normalized, max 200 chars, null if unavailable
);
CREATE INDEX idx_symbol_name_lower ON symbol(name_lower);
-- Reason: "where is X?" scores exact/prefix/substring symbol matches first; this is the
-- hot path of the app's everyday feature.
CREATE INDEX idx_symbol_path ON symbol(path, start_line);
-- Reason: the file viewer's symbol outline needs one ordered range scan per file.

CREATE TABLE import_edge (
  from_path    TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  specifier    TEXT NOT NULL,         -- raw source text, e.g. '@/lib/db' or '..models'
  line         INTEGER NOT NULL,
  to_path      TEXT,                  -- repo-relative POSIX, null when unresolved/external
  to_external  TEXT,                  -- package name when external, else null
  kind         TEXT NOT NULL,         -- static|dynamic|require|reexport|type
  is_type_only INTEGER NOT NULL,
  PRIMARY KEY (from_path, specifier, line)
);
CREATE INDEX idx_import_edge_to ON import_edge(to_path);
-- Reason: in-degree, PageRank iteration, and the "importers of this file" panel all
-- traverse edges in the reverse direction.

CREATE TABLE token_index (
  token     TEXT NOT NULL,            -- lowercase, length >= 3, identifier- or word-split
  path      TEXT NOT NULL REFERENCES file_cache(path) ON DELETE CASCADE,
  count     INTEGER NOT NULL,
  lines_json TEXT NOT NULL,           -- ascending int array, capped at MAX_LINES_PER_TOKEN=20
  PRIMARY KEY (token, path)
);
CREATE INDEX idx_token_index_token ON token_index(token);
-- Reason: content search resolves a query term to candidate files with one index seek
-- instead of scanning the repo; this replaces a bundled ripgrep (A12).

CREATE TABLE analysis_result (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  fingerprint    TEXT NOT NULL,       -- sha256 of canonical JSON, fingerprint field excluded
  result_json    TEXT NOT NULL
);
-- Reason for the single-row CHECK: a repo has exactly one current result; this makes
-- "serve the warm result" a primary-key read with no ordering ambiguity.
