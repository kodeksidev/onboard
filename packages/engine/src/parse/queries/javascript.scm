; @onboard/engine — tree-sitter query for the `javascript` grammar (.js/.jsx).
;
; Captures are broad structural matches; kind refinement (const vs variable,
; export detection, container walking, component/hook naming heuristics,
; type-only detection) happens in ts-parser.ts, which is the same code that
; consumes ts.scm/tsx.scm. This file intentionally contains no TypeScript-only
; node types (interface_declaration, type_alias_declaration, enum_declaration),
; because tree-sitter-javascript's Language does not define them and a Query
; referencing an unknown node type fails to compile (see docs/DECISIONS.md).

; ---- functions, classes, methods ----
(function_declaration name: (identifier) @symbol.function)
(generator_function_declaration name: (identifier) @symbol.function)
(class_declaration name: (_) @symbol.class)
(method_definition name: (_) @symbol.method)

; ---- top-level const/let/var (restricted to `program`'s direct children,
;      with or without an `export` wrapper, so nested locals are not indexed) ----
(program (lexical_declaration (variable_declarator name: (identifier) @symbol.lexical)))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @symbol.lexical))))
(program (variable_declaration (variable_declarator name: (identifier) @symbol.var)))
(program (export_statement (variable_declaration (variable_declarator name: (identifier) @symbol.var))))

; ---- imports / requires / dynamic imports / re-exports ----
(import_statement) @import.stmt
(export_statement source: (string)) @import.reexport_stmt
(call_expression
  function: (identifier) @import.require_callee
  arguments: (arguments (string) @import.require_arg)
  (#eq? @import.require_callee "require")) @import.require_stmt
(call_expression
  function: (import)
  arguments: (arguments (_) @import.dynamic_arg)) @import.dynamic_stmt

; ---- route registrations, e.g. `router.get('/users/:id', handler)` ----
; The leading `.` anchors the path string to the FIRST argument, and the
; second `(_)` pattern requires at least one MORE argument after it (a
; handler/middleware) — together these require a >=2-argument call whose
; first argument is a string. Without both constraints this over-matched
; ordinary one-argument `.get(key)`-style calls (`Map.get`, a test's
; `result.get('a')`, ...) as phantom routes: same name + same call-site
; line as a genuinely different `.get(...)` call on the same source line
; collided on `symbol.id` (path#name#startLine omits `kind`), which is
; how "UNIQUE constraint failed: symbol.id" surfaced on real repos with
; `.get(...)` calls unrelated to routing (see docs/DECISIONS.md).
(call_expression
  function: (member_expression
    object: (identifier)
    property: (property_identifier) @route.method)
  arguments: (arguments
    . (string) @route.path
    (_) @route.handler)
  (#any-of? @route.method "get" "post" "put" "delete" "patch" "options" "head" "use")) @route.call
