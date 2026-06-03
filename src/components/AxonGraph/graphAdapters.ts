import type { ResolvedGraph, ResolvedNode, ResolvedEdge, ReportedStatus, VisualStatus } from "../../types";
import { scoreToColor, statusToScore, UNKNOWN_COLOR } from "./healthColors";

const BASE_SATELLITE_SIZE = 4;

export interface GraphNode {
  id: string;
  label: string;
  color: string;
  nodeSize: number;
  isSatellite: boolean;
  parentId?: string;
  checkName?: string;
  checkStatus?: ReportedStatus;
  sourceNode?: ResolvedNode;
  // set by react-force-graph at runtime
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  color: string;
  label: string;
  phase: number;
  visualStatus?: VisualStatus;
  sourceEdge?: ResolvedEdge;
  isTether?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface OrbitConfig {
  radius: number;
  phase: number;
}

export function buildOrbitConfigs(nodes: GraphNode[]): Map<string, OrbitConfig> {
  const configs = new Map<string, OrbitConfig>();
  const parentGroups = new Map<string, GraphNode[]>();

  for (const node of nodes) {
    if (node.isSatellite && node.parentId) {
      const group = parentGroups.get(node.parentId) ?? [];
      group.push(node);
      parentGroups.set(node.parentId, group);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const [parentId, sats] of parentGroups) {
    const parent = nodeById.get(parentId);
    const radius = (parent?.nodeSize ?? 8) * 2.8;
    sats.forEach((sat, idx) => {
      configs.set(sat.id, { radius, phase: (idx / sats.length) * 2 * Math.PI });
    });
  }

  return configs;
}

function nodeColor(node: ResolvedNode): string {
  // Gray only when unmeasured AND no upstream has influenced this node
  if (node.reportedStatus === "unknown" && node.influenceScore === 0) return UNKNOWN_COLOR;
  return scoreToColor(node.finalScore);
}

function edgeColor(edge: ResolvedEdge): string {
  // Gray only when the edge itself is unmeasured and no upstream node has influenced it
  if (edge.reportedStatus === "unknown" && edge.visualStatus === "healthy") return UNKNOWN_COLOR;
  return scoreToColor(statusToScore(edge.visualStatus));
}

export function buildGraphData(graph: ResolvedGraph): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    nodes.push({
      id: node.id,
      label: node.label,
      color: nodeColor(node),
      nodeSize: node.size * 8,
      isSatellite: false,
      sourceNode: node,
    });

    // Satellites: one per health check
    node.health.checks.forEach((check, idx) => {
      nodes.push({
        id: `${node.id}__sat__${idx}`,
        label: check.name,
        color: check.status === "unknown" ? UNKNOWN_COLOR : scoreToColor(statusToScore(check.status)),
        nodeSize: Math.max(BASE_SATELLITE_SIZE, node.size * 3),
        isSatellite: true,
        parentId: node.id,
        checkName: check.name,
        checkStatus: check.status,
        sourceNode: node,
      });
    });
  }

  for (const edge of graph.edges) {
    links.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      color: edgeColor(edge),
      label: edge.label,
      phase: Math.random(),
      visualStatus: edge.visualStatus,
      sourceEdge: edge,
    });
  }

  // Satellite tether links — visible but subtle
  for (const node of nodes) {
    if (node.isSatellite && node.parentId) {
      links.push({
        id: `${node.id}__sat_link`,
        source: node.parentId,
        target: node.id,
        color: "rgba(255,255,255,0.18)",
        label: "",
        phase: 0,
        isTether: true,
      });
    }
  }

  return { nodes, links };
}
