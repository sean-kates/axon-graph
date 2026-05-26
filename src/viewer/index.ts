import ForceGraph from "force-graph";
import { propagate } from "../engine";
import { buildGraphData, buildOrbitConfigs, type GraphNode, type GraphLink, type OrbitConfig } from "../components/AxonGraph/graphAdapters";
import { drawNode, drawLink } from "../components/AxonGraph/drawing";
import type { ResolvedGraph, ResolvedNode, ResolvedEdge } from "../types";

// ── Info panel ────────────────────────────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  healthy: "#4ade80",
  at_risk: "#86efac",
  degraded: "#fbbf24",
  failing: "#f87171",
  unknown: "#9ca3af",
};

function badge(status: string): string {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function showPanel(selected: ResolvedNode | ResolvedEdge): void {
  const panel = document.getElementById("panel")!;
  const panelType = document.getElementById("panel-type")!;
  const panelTitle = document.getElementById("panel-title")!;
  const panelBody = document.getElementById("panel-body")!;

  const isNode = "healthRollup" in selected;
  panelType.textContent = isNode ? "Table Node" : "Job Edge";
  panelTitle.textContent = selected.label;

  let html = "";
  html += `<div class="section"><div class="section-label">REPORTED STATUS</div>${badge(selected.health.status)}</div>`;
  html += `<div class="section"><div class="section-label">VISUAL STATUS</div>${badge(selected.visualStatus)}`;
  if (selected.visualReason) {
    html += `<div class="reason">${selected.visualReason}</div>`;
  }
  html += "</div>";

  if (selected.health.checks.length > 0) {
    html += `<div class="section"><div class="section-label">${isNode ? "HEALTH CHECKS" : "JOB CHECKS"}</div>`;
    for (const c of selected.health.checks) {
      const border = STATUS_BORDER[c.status] ?? "#9ca3af";
      html += `<div class="check" style="border-left:3px solid ${border}">`;
      html += `<div class="check-header"><span class="check-name">${c.name}</span>${badge(c.status)}</div>`;
      html += `<div class="check-msg">${c.message}</div></div>`;
    }
    html += "</div>";
  }

  if (!isNode) {
    const edge = selected as ResolvedEdge;
    html += `<div class="section"><div class="section-label">SOURCES → TARGET</div>`;
    html += `<div style="font-size:12px;color:#94a3b8">${edge.sources.join(", ")} → ${edge.target}</div></div>`;
  }

  panelBody.innerHTML = html;
  panel.classList.add("open");
}

// ── App ───────────────────────────────────────────────────────────────────────

let frameTime = 0;
let globalTime = 0;
let resolvedGraph: ResolvedGraph | null = null;
let graph: any = null;
let currentNodes: GraphNode[] = [];
let orbitConfig: Map<string, OrbitConfig> = new Map();

function initGraph(raw: Parameters<typeof propagate>[0]): void {
  resolvedGraph = propagate(raw);
  const { nodes, links } = buildGraphData(resolvedGraph);
  orbitConfig = buildOrbitConfigs(nodes);
  currentNodes = nodes;

  if (graph) {
    graph.graphData({ nodes, links });
    setTimeout(() => graph!.zoomToFit(400, 60), 600);
    return;
  }

  graph = new (ForceGraph as any)()(document.getElementById("graph")!)
    .width(window.innerWidth)
    .height(window.innerHeight)
    .backgroundColor("#070a10")
    .graphData({ nodes, links })
    .dagMode("td")
    .dagLevelDistance(120)
    .dagNodeFilter((node: object) => !(node as GraphNode).isSatellite)
    .cooldownTicks(Infinity)
    .onRenderFramePre(() => {
      frameTime += 0.04;
      globalTime = performance.now();
      if (resolvedGraph?.config.satelliteOrbit === false) return;
      if (currentNodes.length === 0) return;
      const speed = resolvedGraph?.config.satelliteOrbitSpeed ?? 0.5;
      const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
      for (const node of currentNodes) {
        if (!node.isSatellite || !node.parentId) continue;
        const parent = nodeById.get(node.parentId);
        if (!parent || parent.x == null || parent.y == null) continue;
        const cfg = orbitConfig.get(node.id);
        if (!cfg) continue;
        const angle = frameTime * speed + cfg.phase;
        node.fx = parent.x + cfg.radius * Math.cos(angle);
        node.fy = parent.y + cfg.radius * Math.sin(angle);
      }
    })
    .nodeCanvasObject((node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      drawNode(node as GraphNode, ctx, frameTime, resolvedGraph, globalScale);
    })
    .nodeCanvasObjectMode(() => "replace")
    .linkCanvasObject((link: object, ctx: CanvasRenderingContext2D) => {
      drawLink(link as GraphLink, ctx, globalTime);
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
        const parent = resolvedGraph?.nodes.find((x) => x.id === n.parentId);
        if (parent) showPanel(parent);
      } else {
        const found = resolvedGraph?.nodes.find((x) => x.id === n.id);
        if (found) showPanel(found);
      }
    })
    .onLinkClick((link: object) => {
      const l = link as GraphLink;
      if (!l.isTether && l.sourceEdge) showPanel(l.sourceEdge);
    });

  (graph as any).d3Force("charge").strength((node: GraphNode) => node.isSatellite ? 0 : -2000);
  (graph as any).d3Force("link")
    .distance((link: GraphLink) => link.id.endsWith("__sat_link") ? 18 : 80)
    .strength((link: GraphLink) => link.id.endsWith("__sat_link") ? 0 : 1);

  setTimeout(() => graph!.zoomToFit(400, 60), 800);
  setTimeout(() => graph!.zoomToFit(400, 60), 3500);

  window.addEventListener("resize", () => {
    graph!.width(window.innerWidth).height(window.innerHeight);
    graph!.zoomToFit(400, 60);
  });
}

async function load(): Promise<void> {
  const raw = await fetch("/api/axon").then((r) => r.json());
  initGraph(raw);
  const ts = document.getElementById("timestamp");
  if (ts) ts.textContent = "Last updated: " + new Date().toLocaleTimeString();
}

document.getElementById("panel-close")!.addEventListener("click", () => {
  document.getElementById("panel")!.classList.remove("open");
});

load();
setInterval(load, 30_000);
