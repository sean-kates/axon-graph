import { propagate } from "../engine";
import { buildGraphData, buildOrbitConfigs, type GraphNode, type OrbitConfig } from "../components/AxonGraph/graphAdapters";
import { initForceGraph } from "../components/AxonGraph/graphSetup";
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

  graph = initForceGraph(document.getElementById("graph")!, window.innerWidth, window.innerHeight, {
    tick: () => { frameTime += 0.04; globalTime = performance.now(); },
    getFrameTime: () => frameTime,
    getGlobalTime: () => globalTime,
    getResolvedGraph: () => resolvedGraph,
    getCurrentNodes: () => currentNodes,
    getOrbitConfig: () => orbitConfig,
    showPanel,
  });
  graph.graphData({ nodes, links });

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
