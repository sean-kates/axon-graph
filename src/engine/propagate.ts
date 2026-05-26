import type {
  RawGraph,
  ResolvedGraph,
  ResolvedNode,
  ResolvedEdge,
  ReportedStatus,
  VisualStatus,
} from "../types";

const REPORTED_SCORES: Record<ReportedStatus, number> = {
  failing: 1.0,
  unknown: 0.3,
  healthy: 0.0,
};

const VISUAL_SEVERITY: Record<VisualStatus, number> = {
  healthy: 0,
  at_risk: 1,
  degraded: 2,
  failing: 3,
};

function worstVisualStatus(a: VisualStatus, b: VisualStatus): VisualStatus {
  return VISUAL_SEVERITY[a] >= VISUAL_SEVERITY[b] ? a : b;
}

// at_risk is info-panel only; treat it as healthy when propagating through edges
function visualToEdgeStatus(vs: VisualStatus): VisualStatus {
  return vs === "at_risk" ? "healthy" : vs;
}

// unknown edge health is visualized as at_risk
function reportedToVisual(s: ReportedStatus): VisualStatus {
  return s === "unknown" ? "at_risk" : s;
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
    const startScore = REPORTED_SCORES[startNode.health.status];
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
    const reportedScore = REPORTED_SCORES[reportedStatus] ?? 0;
    const influence = nodeInfluence.get(node.id);
    const influenceScore = influence?.score ?? 0;
    const finalScore = Math.max(reportedScore, influenceScore);

    // Only bump visualStatus when upstream pushes beyond the node's own score
    const visualStatus: VisualStatus =
      influenceScore > reportedScore
        ? finalScoreToVisualStatus(finalScore)
        : reportedToVisual(reportedStatus);

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
    const ownVisual = reportedToVisual(ownStatus);

    let worstSourceStatus: VisualStatus = "healthy";
    let worstSourceLabel: string | null = null;
    for (const srcId of edge.sources) {
      const srcNode = resolvedNodeMap.get(srcId);
      if (srcNode) {
        const srcStatus = visualToEdgeStatus(srcNode.visualStatus);
        if (VISUAL_SEVERITY[srcStatus] > VISUAL_SEVERITY[worstSourceStatus]) {
          worstSourceStatus = srcStatus;
          worstSourceLabel = srcNode.label;
        }
      }
    }

    const visualStatus = worstVisualStatus(ownVisual, worstSourceStatus);
    const visualReason =
      visualStatus !== ownVisual && worstSourceLabel
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
