import type {
  RawGraph,
  ResolvedGraph,
  ResolvedNode,
  ResolvedEdge,
  HealthStatus,
} from "../types";

// Health severity order for comparison
const SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  failing: 3,
};

function worstStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// Converts a propagated influence score into a status bump.
// score = baseScore * decayFactor^hops
// >= 0.8 → failing, >= 0.4 → degraded, else no impact
function scoreToStatus(score: number): HealthStatus | null {
  if (score >= 0.8) return "failing";
  if (score >= 0.4) return "degraded";
  return null;
}

// Base propagation score for a source node's reported status
function baseScore(status: HealthStatus): number {
  switch (status) {
    case "failing":
      return 1.0;
    case "degraded":
      return 0.6;
    case "unknown":
      return 0.3;
    case "healthy":
      return 0;
  }
}

export function propagate(graph: RawGraph): ResolvedGraph {
  const { decayFactor, maxDepth } = graph.config.propagation;

  // Build adjacency: nodeId → outgoing edges (edges where node is a source)
  const outEdges = new Map<string, string[]>(); // nodeId → edgeIds
  const edgeMap = new Map(graph.edges.map((e) => [e.id, e]));

  for (const node of graph.nodes) {
    outEdges.set(node.id, []);
  }
  for (const edge of graph.edges) {
    for (const src of edge.sources) {
      outEdges.get(src)?.push(edge.id);
    }
  }

  // For each node, track the worst (influence_score, source_label) arriving from upstream
  // influence_score: what decayed score reaches this node
  const nodeInfluence = new Map<string, { score: number; from: string }>();

  // BFS from each non-healthy node
  for (const startNode of graph.nodes) {
    const startScore = baseScore(startNode.health.status);
    if (startScore === 0) continue;

    // BFS: queue entries are [edgeId, hops]
    const queue: Array<{ edgeId: string; hops: number }> = [];
    for (const eid of outEdges.get(startNode.id) ?? []) {
      queue.push({ edgeId: eid, hops: 1 });
    }

    const visited = new Set<string>();

    while (queue.length > 0) {
      const { edgeId, hops } = queue.shift()!;
      if (hops > maxDepth) continue;

      const edge = edgeMap.get(edgeId)!;
      const targetId = edge.target;
      const visitKey = `${edgeId}:${hops}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const score = startScore * Math.pow(decayFactor, hops);
      const current = nodeInfluence.get(targetId);
      if (!current || score > current.score) {
        nodeInfluence.set(targetId, { score, from: startNode.label });
      }

      // Continue propagating from target
      for (const nextEdgeId of outEdges.get(targetId) ?? []) {
        queue.push({ edgeId: nextEdgeId, hops: hops + 1 });
      }
    }
  }

  // Resolve nodes
  const resolvedNodes: ResolvedNode[] = graph.nodes.map((node) => {
    const reportedStatus = node.health.status;
    const influence = nodeInfluence.get(node.id);

    if (!influence) {
      return { ...node, visualStatus: reportedStatus, visualReason: null };
    }

    const upstreamStatus = scoreToStatus(influence.score);
    if (!upstreamStatus) {
      return { ...node, visualStatus: reportedStatus, visualReason: null };
    }

    const visualStatus = worstStatus(reportedStatus, upstreamStatus);
    const visualReason =
      visualStatus !== reportedStatus
        ? `Upstream failure from ${influence.from}`
        : null;

    return { ...node, visualStatus, visualReason };
  });

  // Build resolved node map for edge resolution
  const resolvedNodeMap = new Map(resolvedNodes.map((n) => [n.id, n]));

  // Resolve edges: visualStatus = worst of (own health.status, worst source visualStatus)
  const resolvedEdges: ResolvedEdge[] = graph.edges.map((edge) => {
    const ownStatus = edge.health.status;

    // Worst visualStatus among all source nodes
    let worstSourceStatus: HealthStatus = "healthy";
    let worstSourceLabel: string | null = null;
    for (const srcId of edge.sources) {
      const srcNode = resolvedNodeMap.get(srcId);
      if (srcNode && SEVERITY[srcNode.visualStatus] > SEVERITY[worstSourceStatus]) {
        worstSourceStatus = srcNode.visualStatus;
        worstSourceLabel = srcNode.label;
      }
    }

    const visualStatus = worstStatus(ownStatus, worstSourceStatus);
    const visualReason =
      visualStatus !== ownStatus && worstSourceLabel
        ? `Source node ${worstSourceLabel} is ${worstSourceStatus}`
        : null;

    return { ...edge, visualStatus, visualReason };
  });

  return {
    config: graph.config,
    nodeTypes: graph.nodeTypes,
    edgeTypes: graph.edgeTypes,
    nodes: resolvedNodes,
    edges: resolvedEdges,
  };
}
