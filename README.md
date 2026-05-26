# axon-graph

Data pipeline health visualization library with a nervous system / star chart aesthetic.

Visualizes ClickHouse tables (or any data nodes) connected by data jobs, with live health status that propagates downstream through the graph using a configurable decay model.

## Install

```bash
npm install axon-graph
```

## React component

```tsx
import { AxonGraph } from 'axon-graph';

function Dashboard() {
  return (
    <AxonGraph
      configUrl="/api/axon"
      pollInterval={30000}
      width={1200}
      height={700}
    />
  );
}
```

Your endpoint at `configUrl` must return a `RawGraph` JSON object (see schema below). The component owns the fetch/poll loop — no external state management needed.

## CLI viewer

Spin up a local viewer pointed at a JSON config file:

```bash
npx axon-graph --config axon-graph.json
# or with a custom port
npx axon-graph --config axon-graph.json --port 3000
```

Opens `http://localhost:4242` in your browser.

## Propagation engine (pure logic)

Use the engine directly without any React:

```ts
import { propagate } from 'axon-graph';
import type { RawGraph, ResolvedGraph } from 'axon-graph';

const raw: RawGraph = await fetchGraph();
const resolved: ResolvedGraph = propagate(raw);

// Each node now has:
// resolved.nodes[i].health.status  — what the backend reported
// resolved.nodes[i].visualStatus   — what the graph should show (with upstream decay)
// resolved.nodes[i].visualReason   — e.g. "Upstream failure from raw_events"
```

## How propagation works

1. Walk the graph from each non-healthy node following outgoing edges
2. At each hop, multiply the source's severity score by `decayFactor`
3. At each target node, take the worst arriving influence score
4. Convert score → status: `≥ 0.8 → failing`, `≥ 0.4 → degraded`, else no change
5. `visualStatus` = worst of `reportedStatus` and the derived upstream status
6. Stop at `maxDepth` hops

Fan-in edges (multiple sources → one target) are handled: the worst source influence wins.

## Config schema

```jsonc
{
  "config": {
    "pollInterval": 30000,
    "propagation": {
      "decayFactor": 0.5,   // per-hop multiplier on influence score
      "maxDepth": 5         // max hops to propagate
    }
  },
  "nodeTypes": {
    "core": { "label": "Core", "shape": "hexagon" }
    // shapes: hexagon | circle | diamond | square
  },
  "edgeTypes": {
    "cron": { "label": "Cron Job", "style": "solid" }
    // styles: solid | dashed | animated
  },
  "nodes": [
    {
      "id": "events",
      "label": "events",
      "type": "core",
      "size": 2.0,
      "healthRollup": "any",
      "health": {
        "status": "healthy",
        "updatedAt": "2026-05-25T10:00:00Z",
        "checks": [
          {
            "name": "row_count",
            "status": "healthy",
            "message": "10k rows ingested",
            "checkedAt": "2026-05-25T10:00:00Z"
          }
        ]
      },
      "meta": {}
    }
  ],
  "edges": [
    {
      "id": "job_enrich",
      "label": "enrich_events",
      "sources": ["raw_events", "users"],
      "target": "events",
      "type": "cron",
      "health": {
        "status": "healthy",
        "lastRun": "2026-05-25T09:00:00Z",
        "nextExpected": "2026-05-25T10:00:00Z",
        "checks": []
      },
      "meta": {}
    }
  ]
}
```

## Visual design

- **Force-directed, DAG-aware** layout (top-down)
- **Node color** = health-derived: green (healthy) → amber (degraded) → red (failing), driven by a continuous score-based gradient
- **Satellites** = small orbiting dots, one per health check, always visible
- **Edges**: solid / dashed / animated (streaming) based on type; color driven by health
- **Info panel**: click any node or edge to see `reportedStatus` vs `visualStatus` with reason string and full check list

## TypeScript types

All types are exported from the package root:

```ts
import type {
  RawGraph, ResolvedGraph,
  RawNode, ResolvedNode,
  RawEdge, ResolvedEdge,
  HealthStatus, HealthRollup,
  HealthCheck, NodeHealth, EdgeHealth,
  NodeType, EdgeType,
  GraphConfig, PropagationConfig,
} from 'axon-graph';
```

## Demo fixture

```bash
cp node_modules/axon-graph/demo/axon-graph.json .
npx axon-graph --config axon-graph.json
```

The demo graph has 7 nodes across 4 types with one upstream failure (`raw_events`) that propagates degraded status to its downstream consumers.
