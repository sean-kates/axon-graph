import React from "react";
import type { ResolvedNode, ResolvedEdge, ResolvedGraph } from "../../types";

interface InfoPanelProps {
  selected: ResolvedNode | ResolvedEdge | null;
  graph: ResolvedGraph;
  onClose: () => void;
}

function isNode(x: ResolvedNode | ResolvedEdge): x is ResolvedNode {
  return "healthRollup" in x;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  healthy: { bg: "#1a4a1a", text: "#4ade80" },
  at_risk: { bg: "#1a3a2a", text: "#86efac" },
  degraded: { bg: "#4a3a00", text: "#fbbf24" },
  failing: { bg: "#4a1a1a", text: "#f87171" },
  unknown: { bg: "#2a2a2a", text: "#9ca3af" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_BADGE[status] ?? STATUS_BADGE.unknown;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status}
    </span>
  );
}

export function InfoPanel({ selected, graph, onClose }: InfoPanelProps) {
  if (!selected) return null;

  const isNodeSelected = isNode(selected);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 300,
        background: "rgba(10,12,20,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        padding: 20,
        color: "#e2e8f0",
        fontFamily: "monospace",
        fontSize: 13,
        zIndex: 100,
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        maxHeight: "80vh",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {isNodeSelected ? "Table Node" : "Job Edge"}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>
            {selected.label}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>REPORTED STATUS</div>
          <StatusBadge status={selected.health.status} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>VISUAL STATUS</div>
          <StatusBadge status={selected.visualStatus} />
          {selected.visualReason && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
              {selected.visualReason}
            </div>
          )}
        </div>

        {isNodeSelected && selected.health.checks.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>HEALTH CHECKS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {selected.health.checks.map((check) => (
                <div
                  key={check.name}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    borderLeft: `3px solid ${STATUS_BADGE[check.status]?.text ?? "#9ca3af"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{check.name}</span>
                    <StatusBadge status={check.status} />
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{check.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isNodeSelected && (selected as ResolvedEdge).health.checks.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>JOB CHECKS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(selected as ResolvedEdge).health.checks.map((check) => (
                <div
                  key={check.name}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    borderLeft: `3px solid ${STATUS_BADGE[check.status]?.text ?? "#9ca3af"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{check.name}</span>
                    <StatusBadge status={check.status} />
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{check.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isNodeSelected && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>SOURCES → TARGET</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {(selected as ResolvedEdge).sources.join(", ")} → {(selected as ResolvedEdge).target}
            </div>
          </div>
        )}

        {isNodeSelected && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>ROLLUP / TYPE</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {selected.healthRollup} · {selected.type}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
