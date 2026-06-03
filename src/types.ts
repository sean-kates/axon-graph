export type ReportedStatus = "healthy" | "failing" | "unknown";
export type VisualStatus = "healthy" | "at_risk" | "degraded" | "failing";
export type NodeShape = "hexagon" | "circle" | "diamond" | "square";

export interface HealthCheck {
  name: string;
  status: ReportedStatus;
  message: string;
  checkedAt: string;
}

export interface NodeHealth {
  updatedAt: string;
  checks: HealthCheck[];
}

export interface EdgeHealth {
  checks: HealthCheck[];
}

export interface PropagationConfig {
  decayFactor: number;
  maxDepth: number;
}

export interface GraphConfig {
  pollInterval: number;
  propagation: PropagationConfig;
  satelliteOrbit?: boolean;
  satelliteOrbitSpeed?: number;
}

export interface RawNode {
  id: string;
  label: string;
  shape: NodeShape;
  size?: number;
  health: NodeHealth;
  meta: Record<string, unknown>;
}

export interface RawEdge {
  id: string;
  label: string;
  source: string;
  target: string;
  health: EdgeHealth;
  meta: Record<string, unknown>;
}

export interface RawGraph {
  config: GraphConfig;
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface ResolvedNode extends RawNode {
  size: number;
  reportedStatus: ReportedStatus;
  visualStatus: VisualStatus;
  visualReason: string | null;
  finalScore: number;
  influenceScore: number;
}

export interface ResolvedEdge extends RawEdge {
  reportedStatus: ReportedStatus;
  visualStatus: VisualStatus;
  visualReason: string | null;
}

export interface ResolvedGraph {
  config: GraphConfig;
  nodes: ResolvedNode[];
  edges: ResolvedEdge[];
}
