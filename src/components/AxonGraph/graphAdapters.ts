import type { ResolvedGraph, ResolvedNode, ResolvedEdge, HealthStatus } from "../../types";
import { scoreToColor, statusToScore } from "./healthColors";

const BASE_SATELLITE_SIZE = 4;

export interface GraphNode {
  id: string;
  label: string;
  color: string;
  nodeSize: number;
  isSatellite: boolean;
  parentId?: string;
  checkName?: string;
  checkStatus?: HealthStatus;
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
  style: string;
  label: string;
  sourceEdge?: ResolvedEdge;
  isSynthetic?: boolean;
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

export function buildGraphData(graph: ResolvedGraph): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    nodes.push({
      id: node.id,
      label: node.label,
      color: scoreToColor(node.finalScore),
      nodeSize: (node.size ?? 1) * 8,
      isSatellite: false,
      sourceNode: node,
    });

    // Satellites: one per health check
    node.health.checks.forEach((check, idx) => {
      nodes.push({
        id: `${node.id}__sat__${idx}`,
        label: check.name,
        color: scoreToColor(statusToScore(check.status)),
        nodeSize: Math.max(BASE_SATELLITE_SIZE, (node.size ?? 1) * 3),
        isSatellite: true,
        parentId: node.id,
        checkName: check.name,
        checkStatus: check.status,
        sourceNode: node,
      });
    });
  }

  for (const edge of graph.edges) {
    const edgeType = graph.edgeTypes[edge.type];
    const edgeColor = scoreToColor(statusToScore(edge.visualStatus));

    if (edge.sources.length === 1) {
      // Simple edge: source → target
      links.push({
        id: edge.id,
        source: edge.sources[0],
        target: edge.target,
        color: edgeColor,
        style: edgeType?.style ?? "solid",
        label: edge.label,
        sourceEdge: edge,
      });
    } else {
      // Fan-in: create a synthetic hub node at the edge level
      const hubId = `__hub__${edge.id}`;
      nodes.push({
        id: hubId,
        label: edge.label,
        color: edgeColor,
        nodeSize: 5,
        isSatellite: false,
      });

      // Each source → hub
      for (const srcId of edge.sources) {
        links.push({
          id: `${edge.id}__in__${srcId}`,
          source: srcId,
          target: hubId,
          color: edgeColor,
          style: edgeType?.style ?? "solid",
          label: "",
          sourceEdge: edge,
          isSynthetic: true,
        });
      }

      // Hub → target
      links.push({
        id: `${edge.id}__out`,
        source: hubId,
        target: edge.target,
        color: edgeColor,
        style: edgeType?.style ?? "solid",
        label: edge.label,
        sourceEdge: edge,
        isSynthetic: true,
      });
    }
  }

  // Satellite tether links — visible but subtle
  for (const node of nodes) {
    if (node.isSatellite && node.parentId) {
      links.push({
        id: `${node.id}__sat_link`,
        source: node.parentId,
        target: node.id,
        color: "rgba(255,255,255,0.18)",
        style: "solid",
        label: "",
        isSynthetic: true,
        isTether: true,
      });
    }
  }

  return { nodes, links };
}
