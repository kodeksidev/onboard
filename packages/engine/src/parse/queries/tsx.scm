; @onboard/engine — tree-sitter query for the `tsx` grammar (.tsx).
;
; Identical to ts.scm: tree-sitter-typescript's `tsx` grammar shares the same
; node type vocabulary as its `typescript` grammar (it is the same grammar
; plus JSX parsing rules), so every pattern below compiles and matches the
; same way. This project detects React components/hooks by NAME convention
; (PascalCase / `use[A-Z]` — see ts-parser.ts), not by matching `jsx_element`
; shapes, so no JSX-specific capture is needed here. Kept as its own file
; (rather than reusing ts.scm's source string) because Section 14 lists it as
; a separate deliverable and a future JSX-aware refinement should not have to
; be threaded through a query shared with plain .ts files.

; ---- functions, classes, methods ----
(function_declaration name: (identifier) @symbol.function)
(generator_function_declaration name: (identifier) @symbol.function)
(class_declaration name: (_) @symbol.class)
(method_definition name: (_) @symbol.method)

; ---- top-level const/let/var ----
(program (lexical_declaration (variable_declarator name: (identifier) @symbol.lexical)))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @symbol.lexical))))
(program (variable_declaration (variable_declarator name: (identifier) @symbol.var)))
(program (export_statement (variable_declaration (variable_declarator name: (identifier) @symbol.var))))

; ---- TypeScript-only declarations ----
(interface_declaration name: (type_identifier) @symbol.interface)
(type_alias_declaration name: (type_identifier) @symbol.type)
(enum_declaration name: (identifier) @symbol.enum)

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
