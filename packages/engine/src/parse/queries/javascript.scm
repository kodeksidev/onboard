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
; INVARIANT: one route call produces exactly ONE match, whatever its arity.
;
; Both `.` anchors are load-bearing, and for different reasons:
;   - the first pins the path string to the FIRST argument, so a string
;     appearing anywhere else in the call is not mistaken for a path;
;   - the second pins @route.handler to the argument IMMEDIATELY after the
;     path, which both requires a >=2-argument call and — critically —
;     admits exactly one binding.
;
; Two separate crashes ("UNIQUE constraint failed: symbol.id") came from
; getting this wrong in opposite directions (see docs/DECISIONS.md):
;   1. Originally the pattern required only that SOME string appear among
;      the arguments, so one-argument `.get(key)` calls (`Map.get`, a
;      test's `result.get('a')`, ...) became phantom routes; two such calls
;      on one line shared name+startLine and collided.
;   2. The fix for (1) added `(_) @route.handler` UNANCHORED, which binds
;      once per argument following the path. tree-sitter emits one match
;      per binding, so a route emitted `argc - 1` identical symbols, all
;      sharing name+startLine. Any Express route carrying middleware —
;      `router.get(path, validate(...), handler)` — crashed the cache
;      write. Invisible at arity 2, which is the only arity the
;      `node-express` fixture had.
(call_expression
  function: (member_expression
    object: (identifier)
    property: (property_identifier) @route.method)
  arguments: (arguments
    . (string) @route.path
    . (_) @route.handler)
  (#any-of? @route.method "get" "post" "put" "delete" "patch" "options" "head" "use")) @route.call
