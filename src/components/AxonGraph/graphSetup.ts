import ForceGraph from "force-graph";
import { forceCollide } from "d3-force-3d";
import { drawNode, drawLink, drawShape, COLLIDE_BASE_PADDING, COLLIDE_LABEL_SCALE } from "./drawing";
import type { GraphNode, GraphLink, OrbitConfig } from "./graphAdapters";
import type { ResolvedGraph, ResolvedNode, ResolvedEdge, DagMode } from "../../types";

export interface GraphInit {
  tick: () => void;
  getFrameTime: () => number;
  getGlobalTime: () => number;
  getResolvedGraph: () => ResolvedGraph | null;
  getCurrentNodes: () => GraphNode[];
  getCurrentLinks: () => GraphLink[];
  getOrbitConfig: () => Map<string, OrbitConfig>;
  showPanel: (selected: ResolvedNode | ResolvedEdge) => void;
}

interface FocusState {
  nodeId: string | null;
  nodeIds: Set<string>;
  linkIds: Set<string>;
}

function linkEndId(endpoint: unknown): string {
  return typeof endpoint === "string" ? endpoint : (endpoint as GraphNode).id;
}

function computeFocus(
  clickedId: string,
  nodes: GraphNode[],
  links: GraphLink[]
): FocusState {
  const nodeIds = new Set<string>([clickedId]);
  const linkIds = new Set<string>();

  // Build adjacency for upstream (inbound) and downstream (outbound) traversal
  const dataLinks = links.filter((l) => !l.isTether);
  const outEdges = new Map<string, GraphLink[]>();
  const inEdges  = new Map<string, GraphLink[]>();
  for (const link of dataLinks) {
    const srcId = linkEndId(link.source);
    const tgtId = linkEndId(link.target);
    if (!outEdges.has(srcId)) outEdges.set(srcId, []);
    outEdges.get(srcId)!.push(link);
    if (!inEdges.has(tgtId)) inEdges.set(tgtId, []);
    inEdges.get(tgtId)!.push(link);
  }

  // BFS upstream (ancestors only — follow inbound edges backward)
  const upQueue = [clickedId];
  const visited = new Set<string>([clickedId]);
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    for (const link of inEdges.get(id) ?? []) {
      linkIds.add(link.id);
      const srcId = linkEndId(link.source);
      nodeIds.add(srcId);
      if (!visited.has(srcId)) { visited.add(srcId); upQueue.push(srcId); }
    }
  }

  // BFS downstream (descendants only — follow outbound edges forward)
  const downQueue = [clickedId];
  const visitedDown = new Set<string>([clickedId]);
  while (downQueue.length > 0) {
    const id = downQueue.shift()!;
    for (const link of outEdges.get(id) ?? []) {
      linkIds.add(link.id);
      const tgtId = linkEndId(link.target);
      nodeIds.add(tgtId);
      if (!visitedDown.has(tgtId)) { visitedDown.add(tgtId); downQueue.push(tgtId); }
    }
  }

  // Satellites follow their parent node
  for (const node of nodes) {
    if (node.isSatellite && node.parentId && nodeIds.has(node.parentId)) {
      nodeIds.add(node.id);
    }
  }

  // Tether links follow their satellite endpoint
  for (const link of links) {
    if (link.isTether && nodeIds.has(linkEndId(link.target))) {
      linkIds.add(link.id);
    }
  }

  return { nodeId: clickedId, nodeIds, linkIds };
}

export interface ForceGraphOptions {
  dagMode?: DagMode;
  dagLevelDistance?: number;
}

const BG_COLOR = "#070a10";

export function initForceGraph(
  container: HTMLElement,
  width: number,
  height: number,
  cb: GraphInit,
  options: ForceGraphOptions = {}
): any {
  const dagMode = options.dagMode !== undefined ? options.dagMode : "td";
  let focus: FocusState = { nodeId: null, nodeIds: new Set(), linkIds: new Set() };

  const graph: any = new (ForceGraph as any)()(container)
    .width(width)
    .height(height)
    .backgroundColor(BG_COLOR)
    .dagMode(dagMode)
    .dagLevelDistance(options.dagLevelDistance ?? Math.max(120, Math.round(height * 0.18)))
    .dagNodeFilter((node: object) => !(node as GraphNode).isSatellite)
    .cooldownTicks(Infinity)
    .cooldownTime(Infinity)
    .onRenderFramePre(() => {
      cb.tick();
      const resolvedGraph = cb.getResolvedGraph();
      const currentNodes = cb.getCurrentNodes();
      if (resolvedGraph?.config.satelliteOrbit === false) return;
      if (currentNodes.length === 0) return;
      const speed = resolvedGraph?.config.satelliteOrbitSpeed ?? 0.5;
      const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
      for (const node of currentNodes) {
        if (!node.isSatellite || !node.parentId) continue;
        const parent = nodeById.get(node.parentId);
        if (!parent || parent.x == null || parent.y == null) continue;
        const cfg = cb.getOrbitConfig().get(node.id);
        if (!cfg) continue;
        const angle = cb.getFrameTime() * speed + cfg.phase;
        node.fx = parent.x + cfg.radius * Math.cos(angle);
        node.fy = parent.y + cfg.radius * Math.sin(angle);
      }
    })
    .nodeCanvasObject((node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const faded = focus.nodeId !== null && !focus.nodeIds.has(n.id);
      drawNode(n, ctx, cb.getFrameTime(), globalScale, faded);
    })
    .nodeCanvasObjectMode(() => "replace")
    .nodePointerAreaPaint((node: object, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as GraphNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      drawShape(ctx, n.sourceNode?.shape ?? "circle", x, y, n.nodeSize);
      ctx.fill();
    })
    .linkCanvasObject((link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as GraphLink;
      const faded = focus.nodeId !== null && !focus.linkIds.has(l.id);
      drawLink(l, ctx, cb.getGlobalTime(), faded);
    })
    .linkCanvasObjectMode(() => "replace")
    .linkPointerAreaPaint((link: object, color: string, ctx: CanvasRenderingContext2D) => {
      const l = link as GraphLink;
      if (l.isTether) return;
      const src = l.source as unknown as GraphNode;
      const tgt = l.target as unknown as GraphNode;
      if (typeof src !== "object" || typeof tgt !== "object") return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(src.x ?? 0, src.y ?? 0);
      ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);
      ctx.stroke();
    })
    .onNodeClick((node: object) => {
      const n = node as GraphNode;
      const targetId = n.isSatellite && n.parentId ? n.parentId : n.id;

      if (focus.nodeId === targetId) {
        focus = { nodeId: null, nodeIds: new Set(), linkIds: new Set() };
      } else {
        focus = computeFocus(targetId, cb.getCurrentNodes(), cb.getCurrentLinks());
      }

      if (n.isSatellite) {
        const parent = cb.getResolvedGraph()?.nodes.find((x) => x.id === n.parentId);
        if (parent) cb.showPanel(parent);
      } else {
        const found = cb.getResolvedGraph()?.nodes.find((x) => x.id === n.id);
        if (found) cb.showPanel(found);
      }
    })
    .onBackgroundClick(() => {
      focus = { nodeId: null, nodeIds: new Set(), linkIds: new Set() };
    })
    .onLinkClick((link: object) => {
      const l = link as GraphLink;
      if (!l.isTether && l.sourceEdge) cb.showPanel(l.sourceEdge);
    });

  graph.d3Force("charge").strength((node: GraphNode) => node.isSatellite ? 0 : -2000);
  graph.d3Force("link")
    .distance((link: GraphLink) => link.id.endsWith("__sat_link") ? 18 : 80)
    .strength((link: GraphLink) => link.id.endsWith("__sat_link") ? 0 : 1);
  graph.d3Force("collide", forceCollide((node: GraphNode) =>
    node.isSatellite ? node.nodeSize / 2 + 2 : Math.max(node.nodeSize + COLLIDE_BASE_PADDING, node.label.length * COLLIDE_LABEL_SCALE + node.nodeSize * 2)
  ));

  return graph;
}
