; @onboard/engine — tree-sitter query for the `python` grammar (.py).
;
; Python's grammar reuses `function_definition` for both free functions and
; class methods (there is no distinct method node type), so this query
; captures every `function_definition` generically; python-parser.ts decides
; 'method' vs 'function' by checking whether the nearest enclosing block
; belongs to a `class_definition`. Module-level assignments are restricted to
; `module`'s direct children so nested/local variables are not indexed;
; const-vs-variable is decided in code by naming convention (SCREAMING_SNAKE
; -> const, per Python's own convention for constants — see docs/DECISIONS.md).

; ---- functions (incl. methods) and classes ----
(function_definition name: (identifier) @symbol.function_def)
(class_definition name: (identifier) @symbol.class)

; ---- module-level assignment: `X = 1` directly under `module` ----
(module (expression_statement (assignment left: (identifier) @symbol.assignment_target)))

; ---- imports ----
(import_statement) @import.stmt
(import_from_statement) @import.stmt

; ---- importlib.import_module(...) (Section 8.2 rule 6): a literal string
;      argument resolves with the same rules as a normal import; anything
;      else (a variable, an f-string, ...) is a `dynamic-expression`,
;      recorded but never resolved. `.` anchors the capture to the first
;      positional argument only, so a trailing keyword arg (e.g. `package=`)
;      is never mistaken for the module name. ----
(call
  function: (attribute
    object: (identifier) @_importlib_object
    attribute: (identifier) @_importlib_attribute)
  arguments: (argument_list . (_) @import.dynamic_arg)
  (#eq? @_importlib_object "importlib")
  (#eq? @_importlib_attribute "import_module")) @import.dynamic_call

; ---- route registrations via a decorator, e.g. `@app.route('/users/<id>')`
;      or FastAPI-style `@app.get('/users/<id>')` ----
; INVARIANT: one route decorator produces exactly ONE match, and each match
; is positioned on ITS OWN decorator (@route.decorator), not on the shared
; `decorated_definition`.
;
; This pattern carries the guards `ts.scm`/`javascript.scm`/`tsx.scm` were
; given in Phase 11 and this one was not (see docs/DECISIONS.md):
;
;   - `#any-of? @route.method` restricts the decorator to route-registering
;     verbs. Without it ANY `@obj.attr("string")` decorator became a route:
;     across 7,040 real Python files the engine emitted 230 `route` symbols
;     of which only 5 were routes — the rest were `@click.option`,
;     `@mock.patch`, `@unittest.skipIf`, `@_api.deprecated`. That is not
;     only a crash source; it corrupts classification and ranking for every
;     Python repo that does NOT crash.
;
;   - the leading `.` pins the path to the FIRST positional argument. Without
;     it, every direct string child of the argument list produced its own
;     match, so `@click.option("--language", "-l", ...)` emitted two route
;     symbols; two such decorators declaring the same short flag emitted two
;     IDENTICAL rows and collided on `symbol.id`.
;
;   - `#match? @route.path` requires the path to begin with `/`. The verb
;     list alone cannot separate HTTP PATCH from `@mock.patch("os.environ")`,
;     the stdlib patcher, which is everywhere in Python test suites. A
;     denylist of known non-route objects (`mock`, `unittest`, ...) is the
;     same open-ended shape that produced this bug in the first place; the
;     leading slash is a property of what a route IS. Flask and FastAPI both
;     require route paths to start with `/`, while `mock.patch` targets a
;     dotted module path and `click.option` a `--flag`. The optional
;     `[A-Za-z]*` admits string prefixes (`r"/x"`).
;
; Unlike the TS/JS pattern this deliberately does NOT require an argument
; after the path: a route's handler here is the decorated function itself
; (already required by `definition: (function_definition)`), and Flask's
; commonest form `@app.route('/x')` is single-argument.
;
; @route.decorator is what fixes the remaining collision between two GENUINE
; routes: `@app.get("/items")` stacked over `@app.post("/items")` are two
; real routes sharing a name, and taking startLine from the enclosing
; `decorated_definition` gave both the same line — hence the same
; `symbol.id`. Python allows only one decorator per line, so anchoring each
; match to its own decorator makes their start lines distinct by
; construction.
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier)
        attribute: (identifier) @route.method)
      arguments: (argument_list . (string) @route.path))
    (#any-of? @route.method
      "route" "get" "post" "put" "delete" "patch" "options" "head" "websocket")
    (#match? @route.path "^[A-Za-z]*[\"']/")) @route.decorator
  definition: (function_definition)) @route.call
