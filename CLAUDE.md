# axon-graph

Data pipeline health visualization npm package.

## Git workflow

**Never push directly to `main`.** All changes must go through a feature branch and PR:
1. Create a branch (`git checkout -b feat/...` or `fix/...`)
2. Commit there
3. `git push -u origin <branch>`
4. Open a PR targeting `main` with `gh pr create`

## Commands

```bash
npm test              # vitest (propagation engine + healthColors — no browser tests)
npm run type-check    # tsc --noEmit
npm run build         # tsup — produces dist/index.js, dist/cli/index.js, dist/viewer.js
node dist/cli/index.js --config demo/axon-graph.json   # run the viewer on port 4242
```

## Three build outputs

| Output | Entry | Purpose |
|--------|-------|---------|
| `dist/index.js` | `src/index.ts` | npm package — vanilla `mountAxonGraph` API + propagation engine + types |
| `dist/cli/index.js` | `src/cli/index.ts` | `npx axon-graph` — Node HTTP server, serves HTML shell + viewer.js |
| `dist/viewer.js` | `src/viewer/index.ts` | Browser bundle — force-graph bundled in via `noExternal` |

## Source layout

```
src/
  types.ts                        # All TypeScript types (RawGraph, ResolvedGraph, etc.)
  index.ts                        # Package entry — re-exports mountAxonGraph, propagate, types
  d3-force-3d.d.ts                # TypeScript declarations for d3-force-3d
  engine/
    propagate.ts                  # Pure propagation logic (no rendering)
    propagate.test.ts             # 28 vitest tests — run these before touching engine
    index.ts                      # Re-exports propagate
  components/AxonGraph/
    drawing.ts                    # drawNode / drawLink — shared by vanilla API + viewer
    graphAdapters.ts              # ResolvedGraph → force-graph { nodes, links }
    healthColors.ts               # scoreToColor() / scoreToGlow() color math
    healthColors.test.ts          # 12 vitest tests for color interpolation
  vanilla/
    index.ts                      # mountAxonGraph() — framework-agnostic browser API, info panel
  viewer/
    index.ts                      # Browser app — same drawing code, DOM info panel (for CLI)
  cli/
    index.ts                      # Node server — arg parsing, 3 routes (/, /api/axon, /viewer.js)
demo/
  axon-graph.json                 # 19-node payment/fraud pipeline: raw_transactions failing → downstream degraded; raw_fraud_signals unknown (gray, does not degrade neighbors)
  demo.gif                        # Preview animation used in README
```

## Architecture rules

**Engine and renderer are strictly separated.** `src/engine/` has zero rendering imports. The propagation engine is the core value of the package — don't mix concerns.

**`ReportedStatus` and `VisualStatus` are distinct types.** `ReportedStatus` (`healthy | failing | unknown`) appears in `HealthCheck.status` — it is what the backend writes per-check. There is no top-level status field; the engine derives the node/edge reported status from its checks. `VisualStatus` (`healthy | at_risk | degraded | failing`) is what the propagation engine derives for rendering. `degraded` is never written to the database or sent by the backend — it is always derived by the propagation engine from upstream failing nodes. This is a hard invariant.

**`reportedStatus` is derived from checks, never from a stored field.** `NodeHealth` and `EdgeHealth` have no `status` field. The propagation engine calls `deriveReportedStatus(checks)` — no checks → `unknown`, any failing check → `failing`, any unknown check (no failing) → `unknown`, all healthy → `healthy`. The derived value is stored as `ResolvedNode.reportedStatus` and `ResolvedEdge.reportedStatus`. It is never mutated after derivation. `visualStatus` is what the graph shows. `visualReason` explains the difference. The info panel always shows both.

**force-graph is mounted imperatively via DOM element ownership.** `mountAxonGraph(el, config)` takes an `HTMLElement`, creates the graph inside it, and owns the canvas lifecycle. The graph instance is never recreated when data updates — `graph.graphData(...)` is called directly. `new (ForceGraph as any)()` is the instantiation pattern (kapsule class typing workaround).

**`dist/viewer.js` is a self-contained browser bundle.** Both `force-graph` and `d3-force-3d` are bundled in via `noExternal: ["force-graph", "d3-force-3d"]` in tsup. The CLI serves it as a static file. The drawing code in `src/components/AxonGraph/drawing.ts` is the canonical implementation — both `src/vanilla/index.ts` and `src/viewer/index.ts` import from it directly.

## Key design decisions

**Propagation model:**
- Reported scores: `failing=1.0`, `unknown=0.0`, `healthy=0.0`
- `unknown` means "no signal — unmeasured, not unhealthy." It carries zero propagation weight and never degrades downstream neighbors.
- Score at hop N: `reportedScore * decayFactor^N`
- Score ≥ 0.8 → `failing`, ≥ 0.4 → `degraded`, ≥ 0.1 → `at_risk`, else `healthy`
- `visualStatus = worst(reportedStatus, derivedUpstreamStatus)`

**Status is derived from checks, not stored.** `NodeHealth` and `EdgeHealth` have no `status` field. The backend only writes `checks[]`. `deriveReportedStatus(checks)` in the engine computes status at runtime using "any-failing" semantics: if any check is failing the node is failing; if any check is unknown (with no failing) the node is unknown; if all checks are healthy the node is healthy; no checks → unknown. This removes an entire class of bugs where the stored status could disagree with the checks that produced it.

**Unknown renders gray and carries zero propagation weight.** `unknown` means "no signal" — the node is unmeasured, not unhealthy. Rendering: gray (`rgb(100,100,110)`), outside the green→red gradient. A node renders gray only when `reportedStatus === "unknown" AND influenceScore === 0`. If upstream influence has pushed the node's `visualStatus` above `healthy`, the gradient color takes over (color and panel stay consistent). An unknown node's score is 0, so it never degrades downstream neighbors — do not change `REPORTED_SCORES.unknown` without considering this invariant.

**Fan-in edges** (multiple sources → one target): rendered as a synthetic hub node in the graph data. The hub has `isSatellite: false` and no `sourceNode`. Don't promote multi-target jobs to nodes — that's a schema concern.

**Satellite nodes** are health checks rendered as small dots orbiting their parent. They use `dagNodeFilter((node) => !node.isSatellite)` to stay outside the DAG layer computation — without this, the DAG places them one level below their parent making them look like standalone downstream nodes. Tether links (`isTether: true`) are drawn as thin dotted lines.

**Edge lines are always thin (0.75px) solid static lines.** `style` was removed from `EdgeType` — `solid | dashed | animated` no longer exists. The pulse dot is the sole visual differentiator for edge type and health. Dashed lines are not used on regular edges (tether links remain dotted as a structural distinction for satellite orbits, not an edge style).

**Pulse animation:** Traveling dots move source→target on each edge via `drawPulse` in `drawing.ts`. `globalTime = performance.now()` is captured in `onRenderFramePre` and passed to `drawLink` as its third argument. Each link has a `phase: Math.random()` offset assigned in `graphAdapters.ts` to stagger pulses organically. Failing edges fade out mid-transit (~60% of the way) and never arrive. Streaming edges get 3 dots offset at 0/0.33/0.66. Tether links skip pulse entirely (early return in `drawLink`). `PULSE_SPEED` is a module-level constant in `drawing.ts` — tweak for feel.

## Known friction points

- **force-graph TypeScript types**: The library uses kapsule which TypeScript doesn't understand as callable. Always use `new (ForceGraph as any)()` and type the instance as `any`.
- **`dagNodeFilter` is load-bearing**: Do not remove it. Satellite nodes must be excluded from DAG layer assignment or the whole layout breaks.
- **`cooldownTicks(Infinity)` + `onRenderFramePre`**: This is how the pulse animation keeps running after the force simulation stabilizes. force-graph has no `refresh()` method.
- **CLI `dist/cli/index.js` is tiny (~4KB)** by design — all rendering logic lives in `dist/viewer.js`. If the CLI feels broken, check that `dist/viewer.js` exists and that the path resolution (`../viewer.js` relative to `dist/cli/`) is correct.
