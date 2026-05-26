import type {
  RawGraph,
  ResolvedGraph,
  ResolvedNode,
  ResolvedEdge,
  HealthStatus,
  VisualStatus,
} from "../types";

const STATUS_SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  failing: 3,
};

function worstStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

// at_risk is info-panel only; treat it as healthy when propagating through edges
function visualToHealthStatus(vs: VisualStatus): HealthStatus {
  return vs === "at_risk" ? "healthy" : vs;
}

export function baseScore(status: HealthStatus): number {
  switch (status) {
    case "failing":  return 1.0;
    case "degraded": return 0.6;
    case "unknown":  return 0.3;
    case "healthy":  return 0;
  }
}

function finalScoreToVisualStatus(score: number): VisualStatus {
  if (score >= 0.8) return "failing";
  if (score >= 0.4) return "degraded";
  if (score >= 0.1) return "at_risk";
  return "healthy";
}

export function propagate(graph: RawGraph): ResolvedGraph {
  const { decayFactor, maxDepth } = graph.config.propagation;

  // Build adjacency: nodeId → outgoing edgeIds
  const outEdges = new Map<string, string[]>();
  const edgeMap = new Map(graph.edges.map((e) => [e.id, e]));

  for (const node of graph.nodes) {
    outEdges.set(node.id, []);
  }
  for (const edge of graph.edges) {
    for (const src of edge.sources) {
      outEdges.get(src)?.push(edge.id);
    }
  }

  // For each node, track the highest continuous influence score arriving from upstream
  const nodeInfluence = new Map<string, { score: number; from: string }>();

  for (const startNode of graph.nodes) {
    const startScore = baseScore(startNode.health.status);
    if (startScore === 0) continue;

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

      for (const nextEdgeId of outEdges.get(targetId) ?? []) {
        queue.push({ edgeId: nextEdgeId, hops: hops + 1 });
      }
    }
  }

  // Resolve nodes with continuous finalScore
  const resolvedNodes: ResolvedNode[] = graph.nodes.map((node) => {
    const reportedStatus = node.health.status;
    const reportedScore = baseScore(reportedStatus);
    const influence = nodeInfluence.get(node.id);
    const influenceScore = influence?.score ?? 0;
    const finalScore = Math.max(reportedScore, influenceScore);

    // Only bump visualStatus when upstream pushes beyond the node's own score
    const visualStatus: VisualStatus =
      influenceScore > reportedScore
        ? finalScoreToVisualStatus(finalScore)
        : reportedStatus;

    const visualReason =
      (visualStatus as string) !== reportedStatus && influence
        ? `Upstream signal from ${influence.from}`
        : null;

    return { ...node, visualStatus, visualReason, finalScore, influenceScore };
  });

  const resolvedNodeMap = new Map(resolvedNodes.map((n) => [n.id, n]));

  // Resolve edges: visualStatus = worst of (own health, worst source visualStatus)
  const resolvedEdges: ResolvedEdge[] = graph.edges.map((edge) => {
    const ownStatus = edge.health.status;

    let worstSourceStatus: HealthStatus = "healthy";
    let worstSourceLabel: string | null = null;
    for (const srcId of edge.sources) {
      const srcNode = resolvedNodeMap.get(srcId);
      if (srcNode) {
        const srcStatus = visualToHealthStatus(srcNode.visualStatus);
        if (STATUS_SEVERITY[srcStatus] > STATUS_SEVERITY[worstSourceStatus]) {
          worstSourceStatus = srcStatus;
          worstSourceLabel = srcNode.label;
        }
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
