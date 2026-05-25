export type HealthStatus = "healthy" | "degraded" | "failing" | "unknown";
export type HealthRollup = "any" | "all" | "majority";
export type EdgeStyle = "solid" | "dashed" | "animated";
export type NodeShape = "hexagon" | "circle" | "diamond" | "square";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message: string;
  checkedAt: string;
}

export interface NodeHealth {
  status: HealthStatus;
  updatedAt: string;
  checks: HealthCheck[];
}

export interface EdgeHealth {
  status: HealthStatus;
  lastRun?: string;
  nextExpected?: string;
  checks: HealthCheck[];
}

export interface NodeType {
  label: string;
  shape: NodeShape;
  color: string;
}

export interface EdgeType {
  label: string;
  style: EdgeStyle;
  color: string;
}

export interface PropagationConfig {
  decayFactor: number;
  maxDepth: number;
}

export interface GraphConfig {
  pollInterval: number;
  propagation: PropagationConfig;
}

export interface RawNode {
  id: string;
  label: string;
  type: string;
  size: number;
  healthRollup: HealthRollup;
  health: NodeHealth;
  meta: Record<string, unknown>;
}

export interface RawEdge {
  id: string;
  label: string;
  sources: string[];
  target: string;
  type: string;
  health: EdgeHealth;
  meta: Record<string, unknown>;
}

export interface RawGraph {
  config: GraphConfig;
  nodeTypes: Record<string, NodeType>;
  edgeTypes: Record<string, EdgeType>;
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface ResolvedNode extends RawNode {
  visualStatus: HealthStatus;
  visualReason: string | null;
}

export interface ResolvedEdge extends RawEdge {
  visualStatus: HealthStatus;
  visualReason: string | null;
}

export interface ResolvedGraph {
  config: GraphConfig;
  nodeTypes: Record<string, NodeType>;
  edgeTypes: Record<string, EdgeType>;
  nodes: ResolvedNode[];
  edges: ResolvedEdge[];
}
