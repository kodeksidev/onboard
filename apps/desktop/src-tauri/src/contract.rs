//! Rust mirror of the FROZEN TS contract (`packages/contract/src/*.ts`,
//! Section 7). Transcribed field-for-field, type-for-type — this module
//! never reshapes the contract, only transports it. `packages/contract` is
//! never edited from here; a genuine mismatch discovered while wiring this
//! up is a blocking issue for Phase 1, not something to route around.
//!
//! `#[serde(rename_all = "camelCase")]` maps idiomatic Rust `snake_case`
//! field names onto the wire's `camelCase` automatically; enums whose wire
//! values are kebab-case or contain characters that can't be a bare Rust
//! identifier use an explicit `rename`/`rename_all` instead.

#![allow(clippy::struct_excessive_bools)]

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Ts,
    Tsx,
    Js,
    Jsx,
    Py,
    Json,
    Md,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileClassification {
    Entrypoint,
    Route,
    Controller,
    Service,
    Model,
    Component,
    Hook,
    Store,
    Util,
    Config,
    Test,
    Fixture,
    Script,
    Docs,
    Style,
    Asset,
    Generated,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Class,
    Method,
    Const,
    Type,
    Interface,
    Enum,
    Variable,
    Component,
    Hook,
    Route,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Static,
    Dynamic,
    Require,
    Reexport,
    Type,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ecosystem {
    Npm,
    Pypi,
    Stdlib,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ManifestKind {
    #[serde(rename = "package.json")]
    PackageJson,
    #[serde(rename = "requirements.txt")]
    RequirementsTxt,
    #[serde(rename = "pyproject.toml")]
    PyprojectToml,
    #[serde(rename = "setup.py")]
    SetupPy,
    #[serde(rename = "Pipfile")]
    Pipfile,
    #[serde(rename = "go.mod")]
    GoMod,
    #[serde(rename = "Cargo.toml")]
    CargoToml,
    #[serde(rename = "pom.xml")]
    PomXml,
    #[serde(rename = "composer.json")]
    ComposerJson,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    pub path: String,
    pub kind: ManifestKind,
    pub project_name: Option<String>,
    pub version: Option<String>,
    pub package_manager: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyScope {
    Runtime,
    Dev,
    Peer,
    Optional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub name: String,
    pub version_spec: String,
    pub ecosystem: Ecosystem,
    pub scope: DependencyScope,
    pub inferred_role: Option<String>,
    pub imported_by_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStat {
    pub language: Language,
    pub file_count: u64,
    pub line_count: u64,
    pub share_percent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryPointKind {
    Main,
    Bin,
    Script,
    Convention,
    Server,
    TestRunner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPoint {
    pub path: String,
    pub rank: u32,
    pub evidence: String,
    pub kind: EntryPointKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    Binary,
    TooLarge,
    Minified,
    UnsupportedLanguage,
    Unreadable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub path: String,
    pub language: Language,
    pub classification: FileClassification,
    pub module_id: Option<String>,
    pub size_bytes: u64,
    pub line_count: u64,
    pub content_hash: String,
    pub symbol_count: u64,
    pub in_degree: u64,
    pub out_degree: u64,
    pub page_rank: f64,
    pub importance: f64,
    pub importance_rank: u32,
    pub is_parsed: bool,
    pub skip_reason: Option<SkipReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryNode {
    pub path: String,
    pub parent_path: Option<String>,
    pub file_count: u64,
    pub descendant_file_count: u64,
    pub dominant_classification: FileClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEdge {
    pub from_path: String,
    pub to_path: String,
    pub specifier: String,
    pub line: u32,
    pub kind: EdgeKind,
    pub is_type_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDependencyEdge {
    pub package_name: String,
    pub ecosystem: Ecosystem,
    pub imported_by_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnresolvedReason {
    NoMatchOnDisk,
    AliasUnmapped,
    OutsideRepo,
    DynamicExpression,
    NamespacePackage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedImport {
    pub from_path: String,
    pub specifier: String,
    pub line: u32,
    pub reason: UnresolvedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cycle {
    pub id: String,
    pub paths: Vec<String>,
    pub edge_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolEntry {
    pub id: String,
    pub name: String,
    pub kind: SymbolKind,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub is_exported: bool,
    pub container_name: Option<String>,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoadmapSection {
    Entry,
    Core,
    Supporting,
    LeafUtility,
    Unreached,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapStep {
    pub order: u32,
    pub path: String,
    pub companion_paths: Vec<String>,
    pub section: RoadmapSection,
    pub why: String,
    pub depends_on_paths: Vec<String>,
    pub depended_on_by_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleCard {
    pub id: String,
    pub name: String,
    pub dir_path: String,
    pub purpose_by_convention: String,
    pub file_count: u64,
    pub key_file_paths: Vec<String>,
    pub depends_on_module_ids: Vec<String>,
    pub depended_on_by_module_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePackage {
    pub name: String,
    pub dir_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub id: String,
    pub name: String,
    pub root_path_hash: String,
    pub detected_type: String,
    pub source_roots: Vec<String>,
    pub workspace_packages: Vec<WorkspacePackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub files_scanned: u64,
    pub files_ignored: u64,
    pub files_parsed: u64,
    pub files_skipped: u64,
    pub symbol_count: u64,
    pub edge_count: u64,
    pub external_dependency_count: u64,
    pub unresolved_import_count: u64,
    pub cycle_count: u64,
    pub orphan_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackInfo {
    pub manifests: Vec<ManifestInfo>,
    pub languages: Vec<LanguageStat>,
    pub dependencies: Vec<DependencyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphInfo {
    pub cycles: Vec<Cycle>,
    pub orphan_paths: Vec<String>,
    pub component_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapInfo {
    pub steps: Vec<RoadmapStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub schema_version: u32,
    pub fingerprint: String,
    pub repo: RepoInfo,
    pub stats: Stats,
    pub stack: StackInfo,
    pub entry_points: Vec<EntryPoint>,
    pub files: Vec<FileNode>,
    pub directories: Vec<DirectoryNode>,
    pub edges: Vec<ImportEdge>,
    pub external_dependencies: Vec<ExternalDependencyEdge>,
    pub unresolved_imports: Vec<UnresolvedImport>,
    pub graph: GraphInfo,
    pub important_file_paths: Vec<String>,
    pub roadmap: RoadmapInfo,
    pub modules: Vec<ModuleCard>,
    pub symbols: Vec<SymbolEntry>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub walk_ms: f64,
    pub parse_ms: f64,
    pub resolve_ms: f64,
    pub graph_ms: f64,
    pub total_ms: f64,
    pub cache_hit_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEnvelope {
    pub result: AnalysisResult,
    pub engine_version: String,
    pub timings: Timings,
}

// ---------------------------------------------------------------------------
// Section 7.2 — search contract
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub repo_id: String,
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: u32,
}

fn default_search_limit() -> u32 {
    50
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchKind {
    SymbolExact,
    SymbolPrefix,
    SymbolSubstring,
    FilenameExact,
    FilenameSubstring,
    PathSegment,
    Content,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineHit {
    pub line: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub score: f64,
    pub match_kinds: Vec<MatchKind>,
    pub symbol: Option<SymbolEntry>,
    pub line_hits: Vec<LineHit>,
    pub importance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub expanded_terms: Vec<String>,
    pub dropped_terms: Vec<String>,
    pub hits: Vec<SearchHit>,
    pub total_candidate_count: u64,
}

// ---------------------------------------------------------------------------
// `read_repo_file` / `engine.readFile` shared result shape (Section 7.3/7.4)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub language: Language,
    pub line_count: u64,
    pub is_truncated: bool,
    pub content: String,
}

// ---------------------------------------------------------------------------
// `engine.snippets` (Section 7.3): "The only source of text the AI path may
// use." Phase 12 step 1's `privacy::redact::redact` accepts exactly this
// wire shape (never a bare `String`) — see that module's doc comment for
// what that does and does not guarantee. These two types derive
// `Deserialize` deliberately: they exist ONLY to receive the real sidecar
// RPC response, which is legitimately untrusted external input that must be
// deserializable; that is not true of anything in `privacy::redact`'s own
// output types.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnippetsParams {
    pub repo_id: String,
    pub paths: Vec<String>,
    pub max_lines_per_file: u32,
    pub max_bytes_per_file: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnippet {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnippetsResult {
    pub snippets: Vec<EngineSnippet>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parses `packages/contract/fixtures/sample-analysis.json` — the same
    /// fixture the stub sidecar replays — proving these structs really do
    /// match the frozen contract field-for-field rather than merely
    /// compiling in isolation.
    const SAMPLE_ANALYSIS_ENVELOPE: &str =
        include_str!("../../../../packages/contract/fixtures/sample-analysis.json");

    #[test]
    fn the_frozen_sample_fixture_deserializes_into_analysis_envelope() {
        let envelope: AnalysisEnvelope = serde_json::from_str(SAMPLE_ANALYSIS_ENVELOPE)
            .expect("sample-analysis.json must match the Rust AnalysisEnvelope mirror");
        assert_eq!(envelope.result.schema_version, SCHEMA_VERSION);
        assert!(!envelope.result.files.is_empty());
    }

    #[test]
    fn round_trips_through_serde_without_losing_fields() {
        let envelope: AnalysisEnvelope = serde_json::from_str(SAMPLE_ANALYSIS_ENVELOPE).unwrap();
        let reserialized = serde_json::to_string(&envelope).unwrap();
        let reparsed: AnalysisEnvelope = serde_json::from_str(&reserialized).unwrap();
        assert_eq!(reparsed.result.fingerprint, envelope.result.fingerprint);
    }

    #[test]
    fn manifest_kind_serializes_to_the_literal_dotted_wire_values() {
        let json = serde_json::to_string(&ManifestKind::PackageJson).unwrap();
        assert_eq!(json, "\"package.json\"");
    }

    #[test]
    fn skip_reason_serializes_to_kebab_case() {
        let json = serde_json::to_string(&SkipReason::TooLarge).unwrap();
        assert_eq!(json, "\"too-large\"");
    }

    #[test]
    fn search_request_limit_defaults_to_fifty_when_omitted() {
        let request: SearchRequest =
            serde_json::from_str(r#"{"repoId":"0123456789abcdef","query":"auth"}"#).unwrap();
        assert_eq!(request.limit, 50);
    }

    #[test]
    fn engine_snippets_result_deserializes_the_section_7_3_wire_shape() {
        let json = r#"{"snippets":[{"path":"src/a.ts","startLine":1,"endLine":5,"content":"export const a = 1;"}]}"#;
        let result: EngineSnippetsResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.snippets.len(), 1);
        assert_eq!(result.snippets[0].path, "src/a.ts");
        assert_eq!(result.snippets[0].start_line, 1);
    }
}
