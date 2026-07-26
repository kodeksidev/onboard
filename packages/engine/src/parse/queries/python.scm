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
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier)
        attribute: (identifier) @route.method)
      arguments: (argument_list (string) @route.path)))
  definition: (function_definition)) @route.call
