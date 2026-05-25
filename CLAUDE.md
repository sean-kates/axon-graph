# axon-graph

Data pipeline health visualization npm package. Visualizes nodes (tables) connected by edges (jobs) with live health status that propagates downstream through the graph using a decay model.

## Commands

```bash
npm test              # vitest (propagation engine tests only — no React/browser tests)
npm run type-check    # tsc --noEmit
npm run build         # tsup — produces dist/index.js, dist/cli/index.js, dist/viewer.js
node dist/cli/index.js --config demo/axon-graph.json   # run the viewer on port 4242
```

## Three build outputs

| Output | Entry | Purpose |
|--------|-------|---------|
| `dist/index.js` | `src/index.ts` | npm package — React component + propagation engine + types |
| `dist/cli/index.js` | `src/cli/index.ts` | `npx axon-graph` — Node HTTP server, serves HTML shell + viewer.js |
| `dist/viewer.js` | `src/viewer/index.ts` | Browser bundle — force-graph bundled in via `noExternal` |

## Source layout

```
src/
  types.ts                        # All TypeScript types (RawGraph, ResolvedGraph, etc.)
  index.ts                        # Package entry — re-exports component, engine, types
  engine/
    propagate.ts                  # Pure propagation logic (no rendering)
    propagate.test.ts             # 11 vitest tests — run these before touching engine
  components/AxonGraph/
    AxonGraph.tsx                 # React component — mounts force-graph imperatively
    drawing.ts                    # drawNode / drawLink — shared by React + viewer
    graphAdapters.ts              # ResolvedGraph → force-graph { nodes, links }
    healthColors.ts               # healthColor() / healthGlow() color math
    InfoPanel.tsx                 # Click panel (React) — shows reportedStatus vs visualStatus
    usePolling.ts                 # fetch/poll hook
  viewer/
    index.ts                      # Browser app — same drawing code, DOM info panel
  cli/
    index.ts                      # Node server — arg parsing, 3 routes (/, /api/axon, /viewer.js)
demo/
  axon-graph.json                 # 7-node fixture: raw_events failing → downstream degraded
```

## Architecture rules

**Engine and renderer are strictly separated.** `src/engine/` has zero rendering imports. The propagation engine is the core value of the package — don't mix concerns.

**`reportedStatus` is never mutated.** `health.status` is what the backend said. `visualStatus` is what the graph shows. `visualReason` explains the difference. The info panel always shows both.

**force-graph is mounted imperatively in React** via `useEffect` + `useRef<HTMLDivElement>`. The graph instance is never recreated on re-render — data/size changes go through refs. `new (ForceGraph as any)()` is the instantiation pattern (kapsule class typing workaround).

**`dist/viewer.js` is a self-contained browser bundle.** `force-graph` is bundled in via `noExternal: ["force-graph"]` in tsup. The CLI serves it as a static file. The drawing code in `src/components/AxonGraph/drawing.ts` is the canonical implementation — `src/viewer/index.ts` imports from it directly.

## Key design decisions

**Propagation model:**
- Base scores: `failing=1.0`, `degraded=0.6`, `unknown=0.3`, `healthy=0`
- Score at hop N: `baseScore * decayFactor^N`
- Score ≥ 0.8 → `failing`, ≥ 0.4 → `degraded`, else no upstream effect
- `visualStatus = worst(reportedStatus, derivedUpstreamStatus)`

**Fan-in edges** (multiple sources → one target): rendered as a synthetic hub node in the graph data. The hub has `isSatellite: false` and no `sourceNode`. Don't promote multi-target jobs to nodes — that's a schema concern.

**Satellite nodes** are health checks rendered as small dots orbiting their parent. They use `dagNodeFilter((node) => !node.isSatellite)` to stay outside the DAG layer computation — without this, the DAG places them one level below their parent making them look like standalone downstream nodes. Tether links (`isTether: true`) are drawn as thin dotted lines.

## Known friction points

- **force-graph TypeScript types**: The library uses kapsule which TypeScript doesn't understand as callable. Always use `new (ForceGraph as any)()` and type the instance as `any`.
- **`dagNodeFilter` is load-bearing**: Do not remove it. Satellite nodes must be excluded from DAG layer assignment or the whole layout breaks.
- **`cooldownTicks(Infinity)` + `onRenderFramePre`**: This is how the pulse animation keeps running after the force simulation stabilizes. force-graph has no `refresh()` method.
- **CLI `dist/cli/index.js` is tiny (~4KB)** by design — all rendering logic lives in `dist/viewer.js`. If the CLI feels broken, check that `dist/viewer.js` exists and that the path resolution (`../viewer.js` relative to `dist/cli/`) is correct.
