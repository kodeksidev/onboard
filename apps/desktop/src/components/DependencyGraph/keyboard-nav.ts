/**
 * Pure keyboard-interaction logic for the dependency graph (Phase 8's
 * keyboard paragraph). Deliberately has no dependency on React, Cytoscape,
 * or the DOM, so the entire interaction model is unit-testable without a
 * canvas. `DependencyGraph.tsx` is the only place that wires this to actual
 * `KeyboardEvent`s and the `cytoscape.Core`.
 *
 * `[` / `]` jump to the FIRST (sorted-ascending) dependent / dependency of
 * the currently focused file — not a multi-target cycle. Section 9's
 * keyboard paragraph says "step to dependents/dependencies" without
 * specifying behavior for a file with more than one; jumping to the nearest
 * (alphabetically first) is the simplest deterministic reading and is
 * logged in docs/DECISIONS.md.
 */

export interface GraphKeyboardModel {
  /** File paths ordered ascending by `FileNode.importanceRank` (Section 8.4). */
  readonly orderedPaths: readonly string[];
  /** path -> sorted-ascending paths it imports. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  /** path -> sorted-ascending paths that import it. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
}

export type GraphMoveDirection = 'next' | 'previous';
export type GraphStepDirection = 'dependencies' | 'dependents';

export type GraphKeyCommand =
  | { readonly type: 'move'; readonly direction: GraphMoveDirection }
  | { readonly type: 'step'; readonly direction: GraphStepDirection }
  | { readonly type: 'open' }
  | { readonly type: 'search' }
  | { readonly type: 'exit' }
  | { readonly type: 'none' };

const KEY_COMMANDS: Readonly<Record<string, GraphKeyCommand>> = {
  ArrowDown: { type: 'move', direction: 'next' },
  ArrowUp: { type: 'move', direction: 'previous' },
  '[': { type: 'step', direction: 'dependents' },
  ']': { type: 'step', direction: 'dependencies' },
  Enter: { type: 'open' },
  '/': { type: 'search' },
  Escape: { type: 'exit' },
};

/** Maps a raw `KeyboardEvent.key` to the graph command it represents. */
export function interpretGraphKey(key: string): GraphKeyCommand {
  return KEY_COMMANDS[key] ?? { type: 'none' };
}

function moveFocus(
  model: GraphKeyboardModel,
  currentPath: string,
  direction: GraphMoveDirection,
): string {
  const currentIndex = model.orderedPaths.indexOf(currentPath);
  const lastIndex = model.orderedPaths.length - 1;
  const nextIndex =
    direction === 'next' ? Math.min(currentIndex + 1, lastIndex) : Math.max(currentIndex - 1, 0);
  return model.orderedPaths[nextIndex] ?? currentPath;
}

function stepFocus(
  model: GraphKeyboardModel,
  currentPath: string,
  direction: GraphStepDirection,
): string {
  const table = direction === 'dependencies' ? model.dependencies : model.dependents;
  return table.get(currentPath)?.[0] ?? currentPath;
}

/**
 * Applies one keyboard command to the current focus and returns the new
 * focused path. `Enter`/`Search`/`Exit`/`none` are not focus-movement
 * commands — callers handle those separately — so they pass `currentPath`
 * straight through here.
 */
export function reduceGraphFocus(
  model: GraphKeyboardModel,
  currentPath: string | null,
  command: GraphKeyCommand,
): string | null {
  if (model.orderedPaths.length === 0) {
    return currentPath;
  }
  if (currentPath === null) {
    return command.type === 'move' ? (model.orderedPaths[0] ?? null) : currentPath;
  }
  if (command.type === 'move') {
    return moveFocus(model, currentPath, command.direction);
  }
  if (command.type === 'step') {
    return stepFocus(model, currentPath, command.direction);
  }
  return currentPath;
}
