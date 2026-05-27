import ForceGraph from "force-graph";
import { forceCollide } from "d3-force-3d";
import { propagate } from "../engine";
import {
  buildGraphData,
  buildOrbitConfigs,
  type GraphNode,
  type GraphLink,
  type OrbitConfig,
} from "../components/AxonGraph/graphAdapters";
import { drawNode, drawLink } from "../components/AxonGraph/drawing";
import type { ResolvedGraph, ResolvedNode, ResolvedEdge } from "../types";

export interface MountConfig {
  configUrl: string;
  pollInterval?: number;
  width?: number;
  height?: number;
}

export interface AxonGraphInstance {
  destroy(): void;
}

const DEFAULT_POLL = 30_000;
const BG_COLOR = "#070a10";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  healthy:  { bg: "#1a4a1a", text: "#4ade80" },
  at_risk:  { bg: "#1a3a2a", text: "#86efac" },
  degraded: { bg: "#4a3a00", text: "#fbbf24" },
  failing:  { bg: "#4a1a1a", text: "#f87171" },
  unknown:  { bg: "#2a2a2a", text: "#9ca3af" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function badge(status: string): string {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:${c.bg};color:${c.text};text-transform:uppercase;letter-spacing:0.05em">${esc(status)}</span>`;
}

function buildPanelHTML(selected: ResolvedNode | ResolvedEdge): string {
  const isNode = "healthRollup" in selected;
  let html = "";

  html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">`;
  html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.1em">${isNode ? "Table Node" : "Job Edge"}</div>`;
  html += `<div style="font-size:16px;font-weight:700;color:#f1f5f9">${esc(selected.label)}</div></div>`;
  html += `<button data-close style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0 4px">×</button></div>`;

  html += `<div style="display:flex;flex-direction:column;gap:12px">`;

  html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">REPORTED STATUS</div>${badge(selected.health.status)}</div>`;

  html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">VISUAL STATUS</div>${badge(selected.visualStatus)}`;
  if (selected.visualReason) {
    html += `<div style="margin-top:6px;font-size:11px;color:#94a3b8;font-style:italic">${esc(selected.visualReason)}</div>`;
  }
  html += `</div>`;

  const checks = selected.health.checks;
  if (checks.length > 0) {
    const label = isNode ? "HEALTH CHECKS" : "JOB CHECKS";
    html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:8px">${label}</div><div style="display:flex;flex-direction:column;gap:6px">`;
    for (const check of checks) {
      const border = STATUS_COLORS[check.status]?.text ?? "#9ca3af";
      html += `<div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 10px;border-left:3px solid ${border}">`;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-weight:600;font-size:12px">${esc(check.name)}</span>${badge(check.status)}</div>`;
      html += `<div style="font-size:11px;color:#94a3b8">${esc(check.message)}</div></div>`;
    }
    html += `</div></div>`;
  }

  if (!isNode) {
    const edge = selected as ResolvedEdge;
    html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">SOURCES → TARGET</div>`;
    html += `<div style="font-size:12px;color:#94a3b8">${edge.sources.join(", ")} → ${edge.target}</div></div>`;
  } else {
    html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">ROLLUP / TYPE</div>`;
    html += `<div style="font-size:12px;color:#94a3b8">${selected.healthRollup} · ${selected.type}</div></div>`;
  }

  html += `</div>`;
  return html;
}

export function mountAxonGraph(
  el: HTMLElement,
  config: MountConfig
): AxonGraphInstance {
  const {
    configUrl,
    pollInterval = DEFAULT_POLL,
    width = el.clientWidth || 900,
    height = el.clientHeight || 600,
  } = config;

  if (!["relative", "absolute", "fixed", "sticky"].includes(getComputedStyle(el).position)) {
    el.style.position = "relative";
  }
  el.style.overflow = "hidden";
  el.style.background = BG_COLOR;

  const graphContainer = document.createElement("div");
  graphContainer.style.cssText = `width:${width}px;height:${height}px`;
  el.appendChild(graphContainer);

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:absolute",
    "top:16px",
    "right:16px",
    "width:300px",
    "background:rgba(10,12,20,0.95)",
    "border:1px solid rgba(255,255,255,0.1)",
    "border-radius:12px",
    "padding:20px",
    "color:#e2e8f0",
    "font-family:monospace",
    "font-size:13px",
    "z-index:100",
    "backdrop-filter:blur(8px)",
    "box-shadow:0 8px 32px rgba(0,0,0,0.4)",
    "max-height:80vh",
    "overflow-y:auto",
    "display:none",
  ].join(";");
  el.appendChild(panel);

  const timestamp = document.createElement("div");
  timestamp.style.cssText =
    "position:absolute;bottom:12px;left:12px;font-family:monospace;font-size:11px;color:#374151";
  el.appendChild(timestamp);

  function showPanel(selected: ResolvedNode | ResolvedEdge): void {
    panel.innerHTML = buildPanelHTML(selected);
    panel.style.display = "block";
    panel.querySelector("[data-close]")?.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }

  let frameTime = 0;
  let globalTime = 0;
  let resolvedGraph: ResolvedGraph | null = null;
  let currentNodes: GraphNode[] = [];
  let orbitConfig: Map<string, OrbitConfig> = new Map();
  let firstLoad = true;

  const graph: any = new (ForceGraph as any)()(graphContainer)
    .width(width)
    .height(height)
    .backgroundColor(BG_COLOR)
    .dagMode("td")
    .dagLevelDistance(120)
    .dagNodeFilter((node: object) => !(node as GraphNode).isSatellite)
    .cooldownTicks(Infinity)
    .cooldownTime(Infinity)
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

  graph.d3Force("charge").strength((node: GraphNode) => node.isSatellite ? 0 : -2000);
  graph.d3Force("link")
    .distance((link: GraphLink) => link.id.endsWith("__sat_link") ? 18 : 80)
    .strength((link: GraphLink) => link.id.endsWith("__sat_link") ? 0 : 1);
  graph.d3Force("collide", forceCollide((node: GraphNode) =>
    node.isSatellite ? node.nodeSize / 2 + 2 : Math.max(node.nodeSize + 40, node.label.length * 4 + node.nodeSize)
  ));

  function applyGraphData(raw: Parameters<typeof propagate>[0]): void {
    resolvedGraph = propagate(raw);
    const { nodes, links } = buildGraphData(resolvedGraph);
    orbitConfig = buildOrbitConfigs(nodes);
    currentNodes = nodes;
    graph.graphData({ nodes, links });
    const delay = firstLoad ? 800 : 600;
    firstLoad = false;
    graphTimers.push(setTimeout(() => { if (!destroyed) graph.zoomToFit(400, 60); }, delay));
    if (delay < 800) return;
    graphTimers.push(setTimeout(() => { if (!destroyed) graph.zoomToFit(400, 60); }, 3500));
  }

  const graphTimers: ReturnType<typeof setTimeout>[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  async function fetchAndRender(): Promise<void> {
    try {
      const res = await fetch(configUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      if (!destroyed) {
        applyGraphData(raw);
        timestamp.textContent = "Last updated: " + new Date().toLocaleTimeString();
      }
    } catch {
      // leave previous graph state intact on transient fetch failures
    }
  }

  function schedulePoll(): void {
    pollTimer = setTimeout(async () => {
      await fetchAndRender();
      if (!destroyed) schedulePoll();
    }, pollInterval);
  }

  fetchAndRender().then(() => {
    if (!destroyed) schedulePoll();
  });

  return {
    destroy(): void {
      destroyed = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      graphTimers.forEach(clearTimeout);
      // force-graph has no public destroy(); innerHTML wipe unmounts the canvas.
      // Any window/document listeners bound internally by force-graph will leak —
      // acceptable until force-graph exposes a cleanup API.
      el.innerHTML = "";
    },
  };
}
