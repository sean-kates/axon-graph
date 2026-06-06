import ForceGraph from "force-graph";
import { forceCollide } from "d3-force-3d";
import { drawNode, drawLink, COLLIDE_BASE_PADDING, COLLIDE_LABEL_SCALE } from "./drawing";
import type { GraphNode, GraphLink, OrbitConfig } from "./graphAdapters";
import type { ResolvedGraph, ResolvedNode, ResolvedEdge, DagMode } from "../../types";

export interface GraphInit {
  tick: () => void;
  getFrameTime: () => number;
  getGlobalTime: () => number;
  getResolvedGraph: () => ResolvedGraph | null;
  getCurrentNodes: () => GraphNode[];
  getOrbitConfig: () => Map<string, OrbitConfig>;
  showPanel: (selected: ResolvedNode | ResolvedEdge) => void;
}

export interface ForceGraphOptions {
  dagMode?: DagMode;
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
  const graph: any = new (ForceGraph as any)()(container)
    .width(width)
    .height(height)
    .backgroundColor(BG_COLOR)
    .dagMode(dagMode)
    .dagLevelDistance(Math.max(120, Math.round(height * 0.18)))
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
      drawNode(node as GraphNode, ctx, cb.getFrameTime(), globalScale);
    })
    .nodeCanvasObjectMode(() => "replace")
    .linkCanvasObject((link: object, ctx: CanvasRenderingContext2D) => {
      drawLink(link as GraphLink, ctx, cb.getGlobalTime());
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
      if (n.isSatellite) {
        const parent = cb.getResolvedGraph()?.nodes.find((x) => x.id === n.parentId);
        if (parent) cb.showPanel(parent);
      } else {
        const found = cb.getResolvedGraph()?.nodes.find((x) => x.id === n.id);
        if (found) cb.showPanel(found);
      }
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
