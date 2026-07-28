/**
 * Explicit timeouts for the handful of tests whose work is genuinely slow to
 * initialise, applied per-file rather than by raising the suite default.
 *
 * The distinction matters. A timeout is not a correctness assertion — it is a
 * liveness backstop — so the only thing a generous value costs is the ability
 * to notice a hang. But it costs that for EVERY test it covers. Raising the
 * suite default to 20s would re-green this suite while quietly licensing a
 * test that should finish in 100ms to regress to 8s, forever, silently. The
 * floor for catching a real slowdown must stay low for the ~270 tests that
 * have no reason to be slow.
 *
 * So the default stays at Vitest's modest 5s (see `vitest.config.ts`) and the
 * few files that need headroom ask for it explicitly, which also documents
 * WHICH tests are expensive and why.
 *
 * Measured in isolation, no contention (`vitest run <file>`):
 *
 *   DependencyGraph.axe                4.20s file total
 *   WhereIsSearch.axe                  3.51s file total, slowest test 1.12s
 *   FileViewer.axe                     3.34s file total
 *   RoadmapPanel.graphIntegration      3.18s file total
 *   ModuleMap.axe                      2.72s file total
 *   RoadmapPanel.axe                   2.64s file total
 *   App.test                           3.95s file total, slowest test 1.39s
 *
 * No individual test costs more than ~1.4s of real work. The 5s failures were
 * pure CPU contention from ~47 files sharing a small worker pool, not slow
 * tests — which is exactly why the fix is headroom on the contended files and
 * not a blanket raise.
 *
 * 15s is ~10x the slowest measured test: enough that scheduling noise can
 * never fail it, small enough that a genuinely hung axe scan or an unresolved
 * Cytoscape mount still fails the run instead of stalling CI.
 *
 * WHICH FILES GET THIS, and why it is measured rather than guessed:
 *
 * The first cut of this list was the files that had failed, which produced an
 * inconsistent result — seven files with headroom and nine comparable ones
 * without, including the single slowest file in the suite. Selecting by
 * symptom finds the tests that already lost the race, not the ones about to.
 *
 * So the list is drawn from measurement instead: the suite was run under
 * deliberate CPU oversubscription (12 busy-spin processes on 12 logical
 * cores, which roughly doubled wall time, 28s -> 48-58s) and every test's
 * duration recorded. Any file whose worst test consumed >= 50% of the 5s
 * budget under that load gets headroom, on the grounds that half the budget
 * spent on scheduling noise is too little margin to call a gate reliable.
 *
 * Worst test per file under that load (% of the 5s default):
 *
 *   DependencyGraph.test              3704ms  74%
 *   DependencyGraph.axe               3537ms  71%
 *   WhereIsSearch.axe                 3524ms  70%
 *   FileViewer.axe                    3198ms  64%
 *   RoadmapPanel.graphIntegration     2889ms  58%
 *   App.test                          2801ms  56%
 *   RoadmapPanel.axe                  2317ms  46%   (axe; kept for consistency)
 *   ModuleMap.axe                     2072ms  41%   (axe; kept for consistency)
 *   ---- everything below has no headroom and needs none ----
 *   AiSettingsSection.test            2130ms  43%
 *   WhereIsSearch.test                2043ms  41%
 *   FileViewer.test                   1660ms  33%
 *
 * CORRECTION — the load figures above were the WRONG worst case, and the list
 * they produced was too small. Synthetic CPU load is not the harshest thing
 * this suite meets. Two harsher cases showed up in practice:
 *
 *   1. A real parallel `rustc` build (the src-tauri crate compiling in the
 *      background) is heavier than 12 busy-spin processes, and pushed two
 *      files past even the 15s headroom.
 *   2. A COLD Vite dep-optimization cache — which is exactly what CI gets,
 *      because CI installs dependencies and then runs the suite once. The
 *      first run after any `bun install` pays full transform cost.
 *
 * Cold-cache worst test per file, no other load (% of the 5s default):
 *
 *   App.test                       7789ms  156%
 *   DependencyGraph.test           7497ms  150%
 *   RoadmapPanel.graphIntegration  6641ms  133%
 *   DependencyGraph.axe            5710ms  114%
 *   WhereIsSearch.axe              5197ms  104%
 *   FileViewer.axe                 4860ms   97%
 *   ModuleMap.axe                  4620ms   92%
 *   WhereIsSearch.test             3818ms   76%   <- had no headroom
 *   FileViewer.test                3802ms   76%   <- had no headroom
 *   RoadmapPanel.axe               3064ms   61%
 *
 * Seven files exceed 90% of the default from cold start alone, and the two
 * marked above were the ones that actually failed a real run. They mount
 * CodeMirror, so the ENGINE-MOUNT principle would have caught them; the
 * measured-under-warm-load rule did not. When the principle and the
 * measurement disagree, prefer the principle — a file that mounts CodeMirror,
 * Cytoscape, or axe-core is expensive whether or not one sampling caught it
 * being expensive.
 *
 * Honest note on what this constant does: on a warm cache with no contention,
 * nothing here exceeds 5s. The headroom earns its keep on the cold first run
 * and under real build load. If a test in this list ever exceeds 15s, that is
 * a hang to investigate, not a number to raise.
 */
export const SLOW_MOUNT_TIMEOUT_MS = 15_000;
