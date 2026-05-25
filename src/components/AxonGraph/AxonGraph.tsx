import React, { useRef, useEffect, useState } from "react";
import ForceGraph from "force-graph";
import type { ResolvedNode, ResolvedEdge, ResolvedGraph } from "../../types";
import { usePolling } from "./usePolling";
import { buildGraphData, type GraphNode, type GraphLink } from "./graphAdapters";
import { InfoPanel } from "./InfoPanel";
import { drawNode, drawLink } from "./drawing";

export interface AxonGraphProps {
  configUrl: string;
  pollInterval?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
}

const DEFAULT_POLL = 30_000;

export function AxonGraph({
  configUrl,
  pollInterval = DEFAULT_POLL,
  width = 900,
  height = 600,
  backgroundColor = "#070a10",
}: AxonGraphProps) {
  const { data, error, loading, lastUpdated } = usePolling(configUrl, pollInterval);
  const [selected, setSelected] = useState<ResolvedNode | ResolvedEdge | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Use refs for everything the graph callbacks close over so we never
  // need to recreate the graph instance when data or dimensions change.
  // Typed as `any` to sidestep force-graph's kapsule generic complexity.
  const graphRef = useRef<any>(null);
  const frameTimeRef = useRef(0);
  const resolvedGraphRef = useRef<ResolvedGraph | null>(null);

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
      })
      .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
        drawNode(node, ctx, frameTimeRef.current, resolvedGraphRef.current, globalScale);
      })
      .nodeCanvasObjectMode(() => "replace")
      .linkCanvasObject((link: GraphLink, ctx: CanvasRenderingContext2D) => {
        drawLink(link, ctx, frameTimeRef.current);
      })
      .linkCanvasObjectMode(() => "replace")
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
        if (!link.isSynthetic && link.sourceEdge) setSelected(link.sourceEdge);
      });

    // Tune forces: more repulsion between nodes, short tether for satellites.
    instance.d3Force("charge").strength(-400);
    instance.d3Force("link").distance((link: GraphLink) =>
      link.id.endsWith("__sat_link") ? 18 : 80
    );

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
    graphRef.current.graphData(buildGraphData(data));
  }, [data]);

  // Sync width/height prop changes.
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.width(width).height(height);
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
