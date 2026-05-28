import { propagate } from "../engine";
import {
  buildGraphData,
  buildOrbitConfigs,
  type GraphNode,
  type OrbitConfig,
} from "../components/AxonGraph/graphAdapters";
import { initForceGraph } from "../components/AxonGraph/graphSetup";
import type { ResolvedGraph, ResolvedNode, ResolvedEdge } from "../types";
import { esc } from "../utils/esc";

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

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  healthy:  { bg: "#1a4a1a", text: "#4ade80" },
  at_risk:  { bg: "#1a3a2a", text: "#86efac" },
  degraded: { bg: "#4a3a00", text: "#fbbf24" },
  failing:  { bg: "#4a1a1a", text: "#f87171" },
  unknown:  { bg: "#2a2a2a", text: "#9ca3af" },
};

function badge(status: string): string {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:${c.bg};color:${c.text};text-transform:uppercase;letter-spacing:0.05em">${esc(status)}</span>`;
}

function buildPanelHTML(selected: ResolvedNode | ResolvedEdge): string {
  const isNode = !("sources" in selected);
  let html = "";

  html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">`;
  html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.1em">${isNode ? "Table Node" : "Job Edge"}</div>`;
  html += `<div style="font-size:16px;font-weight:700;color:#f1f5f9">${esc(selected.label)}</div></div>`;
  html += `<button data-close style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0 4px">×</button></div>`;

  html += `<div style="display:flex;flex-direction:column;gap:12px">`;

  html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">REPORTED STATUS</div>${badge(selected.reportedStatus)}</div>`;

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
    html += `<div style="font-size:12px;color:#94a3b8">${esc(edge.sources.join(", "))} → ${esc(edge.target)}</div></div>`;
  } else {
    html += `<div><div style="font-size:11px;color:#64748b;margin-bottom:6px">TYPE</div>`;
    html += `<div style="font-size:12px;color:#94a3b8">${esc(selected.type)}</div></div>`;
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
  el.style.background = "#070a10";

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

  const graph: any = initForceGraph(graphContainer, width, height, {
    tick: () => { frameTime += 0.04; globalTime = performance.now(); },
    getFrameTime: () => frameTime,
    getGlobalTime: () => globalTime,
    getResolvedGraph: () => resolvedGraph,
    getCurrentNodes: () => currentNodes,
    getOrbitConfig: () => orbitConfig,
    showPanel,
  });

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
