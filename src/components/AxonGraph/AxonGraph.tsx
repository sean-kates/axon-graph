import React, { useRef, useEffect, useState } from "react";
import ForceGraph from "force-graph";
import type { ResolvedNode, ResolvedEdge, ResolvedGraph } from "../../types";
import { usePolling } from "./usePolling";
import { buildGraphData, buildOrbitConfigs, type GraphNode, type GraphLink, type OrbitConfig } from "./graphAdapters";
import { InfoPanel } from "./InfoPanel";
import { drawNode, drawLink } from "./drawing";

export interface AxonGraphProps {
  configUrl: string;
  pollInterval?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  satelliteOrbit?: boolean;
  satelliteOrbitSpeed?: number;
}

const DEFAULT_POLL = 30_000;

export function AxonGraph({
  configUrl,
  pollInterval = DEFAULT_POLL,
  width = 900,
  height = 600,
  backgroundColor = "#070a10",
  satelliteOrbit = true,
  satelliteOrbitSpeed = 0.5,
}: AxonGraphProps) {
  const { data, error, loading, lastUpdated } = usePolling(configUrl, pollInterval);
  const [selected, setSelected] = useState<ResolvedNode | ResolvedEdge | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Use refs for everything the graph callbacks close over so we never
  // need to recreate the graph instance when data or dimensions change.
  // Typed as `any` to sidestep force-graph's kapsule generic complexity.
  const graphRef = useRef<any>(null);
  const frameTimeRef = useRef(0);
  const globalTimeRef = useRef(0);
  const resolvedGraphRef = useRef<ResolvedGraph | null>(null);
  const firstDataRef = useRef(true);
  const graphNodesRef = useRef<GraphNode[]>([]);
  const orbitConfigRef = useRef<Map<string, OrbitConfig>>(new Map());
  const orbitEnabledRef = useRef(satelliteOrbit);
  const orbitSpeedRef = useRef(satelliteOrbitSpeed);

  // Keep orbit refs in sync with props so the animation loop always sees current values.
  useEffect(() => { orbitEnabledRef.current = satelliteOrbit; }, [satelliteOrbit]);
  useEffect(() => { orbitSpeedRef.current = satelliteOrbitSpeed; }, [satelliteOrbitSpeed]);

  // Mount the graph once.
  useEffect(() => {
    if (!containerRef.current) return;

    // force-graph is a kapsule class: `new ForceGraph()` returns a
    // configurable function that mounts onto a DOM element when called.
    const instance = new (ForceGraph as any)()(containerRef.current)
      .width(width)
      .height(height)
      .backgroundColor(backgroundColor)
      .dagMode("td")
      .dagLevelDistance(120)
      .dagNodeFilter((node: GraphNode) => !node.isSatellite)
      .cooldownTicks(Infinity)
      .onRenderFramePre(() => {
        frameTimeRef.current += 0.04;
        globalTimeRef.current = performance.now();
        if (!orbitEnabledRef.current) return;
        const nodes = graphNodesRef.current;
        const orbitConfig = orbitConfigRef.current;
        if (nodes.length === 0) return;
        const nodeById = new Map(nodes.map((n) => [n.id, n]));
        for (const node of nodes) {
          if (!node.isSatellite || !node.parentId) continue;
          const parent = nodeById.get(node.parentId);
          if (!parent || parent.x == null || parent.y == null) continue;
          const cfg = orbitConfig.get(node.id);
          if (!cfg) continue;
          const angle = frameTimeRef.current * orbitSpeedRef.current + cfg.phase;
          node.fx = parent.x + cfg.radius * Math.cos(angle);
          node.fy = parent.y + cfg.radius * Math.sin(angle);
        }
      })
      .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
        drawNode(node, ctx, frameTimeRef.current, resolvedGraphRef.current, globalScale);
      })
      .nodeCanvasObjectMode(() => "replace")
      .linkCanvasObject((link: GraphLink, ctx: CanvasRenderingContext2D) => {
        drawLink(link, ctx, globalTimeRef.current);
      })
      .linkCanvasObjectMode(() => "replace")
      .linkPointerAreaPaint((link: GraphLink, color: string, ctx: CanvasRenderingContext2D) => {
        if (link.isTether) return;
        const src = link.source as unknown as GraphNode;
        const tgt = link.target as unknown as GraphNode;
        if (typeof src !== "object" || typeof tgt !== "object") return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(src.x ?? 0, src.y ?? 0);
        ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);
        ctx.stroke();
      })
      .onNodeClick((node: GraphNode) => {
        const rg = resolvedGraphRef.current;
        if (!rg) return;
        if (node.isSatellite) {
          const parent = rg.nodes.find((x) => x.id === node.parentId);
          if (parent) setSelected(parent);
        } else {
          const found = rg.nodes.find((x) => x.id === node.id);
          if (found) setSelected(found);
        }
      })
      .onLinkClick((link: GraphLink) => {
        if (!link.isTether && link.sourceEdge) setSelected(link.sourceEdge);
      });

    // Tune forces: more repulsion between nodes, short tether for satellites.
    instance.d3Force("charge").strength((node: GraphNode) => node.isSatellite ? 0 : -2000);
    instance.d3Force("link")
      .distance((link: GraphLink) => link.id.endsWith("__sat_link") ? 18 : 80)
      .strength((link: GraphLink) => link.id.endsWith("__sat_link") ? 0 : 1);

    graphRef.current = instance;

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
      graphRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push new graph data whenever the poll result changes.
  useEffect(() => {
    if (!data || !graphRef.current) return;
    resolvedGraphRef.current = data;
    const gd = buildGraphData(data);
    orbitConfigRef.current = buildOrbitConfigs(gd.nodes);
    graphNodesRef.current = gd.nodes;
    graphRef.current.graphData(gd);
    const delay = firstDataRef.current ? 800 : 600;
    firstDataRef.current = false;
    setTimeout(() => graphRef.current?.zoomToFit(400, 60), delay);
    setTimeout(() => graphRef.current?.zoomToFit(400, 60), 3500);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync width/height prop changes.
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.width(width).height(height);
    graphRef.current.zoomToFit(400, 60);
  }, [width, height]);

  return (
    <div style={{ position: "relative", width, height, background: backgroundColor }}>
      {loading && !data && (
        <div style={centeredOverlay(width, height)}>
          <Spinner />
          <div style={{ color: "#4a90d9", marginTop: 12, fontFamily: "monospace" }}>
            Loading pipeline graph…
          </div>
        </div>
      )}

      {error && !data && (
        <div style={centeredOverlay(width, height)}>
          <div style={{ color: "#f87171", fontFamily: "monospace", fontSize: 14 }}>
            ⚠ Failed to load: {error.message}
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ width, height }} />

      {data && (
        <InfoPanel
          selected={selected}
          graph={data}
          onClose={() => setSelected(null)}
        />
      )}

      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          fontFamily: "monospace",
          fontSize: 11,
          color: "#374151",
        }}
      >
        {lastUpdated && `Last updated: ${lastUpdated.toLocaleTimeString()}`}
      </div>
    </div>
  );
}

function centeredOverlay(w: number, h: number): React.CSSProperties {
  return {
    position: "absolute",
    top: 0, left: 0,
    width: w, height: h,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  };
}

function Spinner() {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        border: "3px solid rgba(74,144,217,0.2)",
        borderTop: "3px solid #4a90d9",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
