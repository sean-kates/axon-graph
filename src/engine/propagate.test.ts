import { describe, it, expect } from "vitest";
import { propagate, deriveReportedStatus } from "./propagate";
import type { RawGraph, RawNode, RawEdge, HealthCheck } from "../types";

const baseConfig = {
  pollInterval: 30000,
  propagation: { decayFactor: 0.5, maxDepth: 5 },
};

const baseNodeTypes = {
  core: { label: "Core", shape: "hexagon" as const },
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fCheck(name = "s"): HealthCheck {
  return { name, status: "failing", message: "", checkedAt: "" };
}
function hCheck(name = "s"): HealthCheck {
  return { name, status: "healthy", message: "", checkedAt: "" };
}
function uCheck(name = "s"): HealthCheck {
  return { name, status: "unknown", message: "", checkedAt: "" };
}

function makeNode(id: string, checks: HealthCheck[], label?: string): RawNode {
  return {
    id,
    label: label ?? id.toUpperCase(),
    type: "core",
    size: 1,
    health: { updatedAt: "", checks },
    meta: {},
  };
}

function makeEdge(
  id: string,
  sources: string[],
  target: string,
  checks: HealthCheck[] = []
): RawEdge {
  return { id, label: id, sources, target, type: "cron", health: { checks }, meta: {} };
}

function makeGraph(partial: Partial<RawGraph>): RawGraph {
  return {
    config: baseConfig,
    nodeTypes: baseNodeTypes,
    nodes: [],
    edges: [],
    ...partial,
  };
}

// ── deriveReportedStatus unit tests ──────────────────────────────────────────

describe("deriveReportedStatus", () => {
  it("no checks → unknown", () => {
    expect(deriveReportedStatus([])).toBe("unknown");
  });

  it("any failing check → failing", () => {
    expect(deriveReportedStatus([fCheck(), hCheck("b")])).toBe("failing");
  });

  it("failing beats unknown", () => {
    expect(deriveReportedStatus([fCheck(), uCheck("b")])).toBe("failing");
  });

  it("any unknown check (no failing) → unknown", () => {
    expect(deriveReportedStatus([hCheck(), uCheck("b")])).toBe("unknown");
  });

  it("all healthy → healthy", () => {
    expect(deriveReportedStatus([hCheck(), hCheck("b")])).toBe("healthy");
  });
});

// ── Isolated nodes ────────────────────────────────────────────────────────────

describe("propagate — isolated nodes", () => {
  it("passes through healthy node unchanged", () => {
    const graph = makeGraph({ nodes: [makeNode("a", [hCheck()])] });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("healthy");
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
    expect(resolved.nodes[0].visualReason).toBeNull();
  });

  it("passes through failing node unchanged", () => {
    const graph = makeGraph({ nodes: [makeNode("a", [fCheck()])] });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("failing");
    expect(resolved.nodes[0].visualStatus).toBe("failing");
  });

  it("unknown node (no checks) → reportedStatus=unknown, visualStatus=healthy, finalScore=0", () => {
    const graph = makeGraph({ nodes: [makeNode("a", [])] });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("unknown");
    // unknown carries zero weight — visualStatus stays healthy (no upstream pushing it)
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
    expect(resolved.nodes[0].finalScore).toBeCloseTo(0);
  });

  it("unknown node (unknown check) → same as no checks", () => {
    const graph = makeGraph({ nodes: [makeNode("a", [uCheck()])] });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("unknown");
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
  });
});

// ── Single upstream failing ───────────────────────────────────────────────────

describe("propagate — single upstream failing", () => {
  it("downstream of failing node gets degraded at hop 1 (decayFactor 0.5 → degraded)", () => {
    // A (failing) → B (healthy)
    const graph = makeGraph({
      nodes: [makeNode("a", [fCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    expect(b.visualStatus).toBe("degraded");
    expect(b.visualReason).toContain("A");
  });

  it("two hops downstream gets at_risk (decayFactor 0.5^2 = 0.25 → faint upstream signal)", () => {
    // A (failing) → B → C
    const graph = makeGraph({
      nodes: [
        makeNode("a", [fCheck()], "A"),
        makeNode("b", [hCheck()], "B"),
        makeNode("c", [hCheck()], "C"),
      ],
      edges: [
        makeEdge("e1", ["a"], "b", [hCheck()]),
        makeEdge("e2", ["b"], "c", [hCheck()]),
      ],
    });
    const resolved = propagate(graph);
    const c = resolved.nodes.find((n) => n.id === "c")!;
    // influenceScore=0.25, finalScore=0.25 (>= 0.1 threshold), so c gets at_risk
    expect(c.visualStatus).toBe("at_risk");
    expect(c.finalScore).toBeCloseTo(0.25);
  });
});

// ── Unknown carries zero propagation weight ───────────────────────────────────

describe("propagate — unknown node does not degrade neighbors", () => {
  it("downstream of unknown node stays healthy", () => {
    // A (unknown) → B (healthy)
    const graph = makeGraph({
      nodes: [makeNode("a", [], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    expect(b.visualStatus).toBe("healthy");
    expect(b.finalScore).toBeCloseTo(0);
  });
});

// ── maxDepth ──────────────────────────────────────────────────────────────────

describe("propagate — maxDepth", () => {
  it("stops propagation at maxDepth", () => {
    // chain of 6 nodes, maxDepth=2
    const nodes = Array.from({ length: 6 }, (_, i) =>
      makeNode(`n${i}`, i === 0 ? [fCheck()] : [hCheck()])
    );
    const edges = Array.from({ length: 5 }, (_, i) =>
      makeEdge(`e${i}`, [`n${i}`], `n${i + 1}`, [hCheck()])
    );
    const graph = makeGraph({
      config: { ...baseConfig, propagation: { decayFactor: 0.9, maxDepth: 2 } },
      nodes,
      edges,
    });
    const resolved = propagate(graph);
    // n3, n4, n5 are beyond maxDepth=2, should remain healthy
    expect(resolved.nodes.find((n) => n.id === "n3")!.visualStatus).toBe("healthy");
    expect(resolved.nodes.find((n) => n.id === "n4")!.visualStatus).toBe("healthy");
    expect(resolved.nodes.find((n) => n.id === "n5")!.visualStatus).toBe("healthy");
  });
});

// ── Fan-in edges ──────────────────────────────────────────────────────────────

describe("propagate — fan-in edges", () => {
  it("node with fan-in takes worst upstream influence", () => {
    // A (failing) and B (healthy) both write to C
    const graph = makeGraph({
      nodes: [
        makeNode("a", [fCheck()], "A"),
        makeNode("b", [hCheck()], "B"),
        makeNode("c", [hCheck()], "C"),
      ],
      edges: [makeEdge("e1", ["a", "b"], "c", [hCheck()])],
    });
    const resolved = propagate(graph);
    const c = resolved.nodes.find((n) => n.id === "c")!;
    expect(c.visualStatus).toBe("degraded");
  });
});

// ── Derived status from checks ────────────────────────────────────────────────

describe("propagate — derived status from checks", () => {
  it("any failing check derives 'failing' even when mixed with healthy", () => {
    const graph = makeGraph({
      nodes: [
        makeNode("a", [fCheck("check1"), hCheck("check2")]),
      ],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("failing");
    expect(resolved.nodes[0].visualStatus).toBe("failing");
  });

  it("any unknown check (no failing) derives 'unknown'", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [hCheck("check1"), uCheck("check2")])],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("unknown");
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
    expect(resolved.nodes[0].finalScore).toBeCloseTo(0);
  });

  it("all healthy checks derive 'healthy'", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [hCheck("check1"), hCheck("check2")])],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].reportedStatus).toBe("healthy");
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
  });
});

// ── Edge visualStatus ─────────────────────────────────────────────────────────

describe("propagate — edge visualStatus", () => {
  it("edge inherits failing status when source node is failing", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [fCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b")], // no edge checks → unknown own status, but source pushes it
    });
    const resolved = propagate(graph);
    const edge = resolved.edges.find((e) => e.id === "e1")!;
    expect(edge.visualStatus).not.toBe("healthy");
  });

  it("edge with own failing checks shows failing", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [hCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [fCheck()])],
    });
    const resolved = propagate(graph);
    const edge = resolved.edges.find((e) => e.id === "e1")!;
    expect(edge.reportedStatus).toBe("failing");
    expect(edge.visualStatus).toBe("failing");
  });

  it("edge with no checks and healthy source → reportedStatus=unknown, visualStatus=healthy", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [hCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b")], // no checks
    });
    const resolved = propagate(graph);
    const edge = resolved.edges.find((e) => e.id === "e1")!;
    expect(edge.reportedStatus).toBe("unknown");
    expect(edge.visualStatus).toBe("healthy");
  });
});

// ── finalScore continuous model ───────────────────────────────────────────────

describe("propagate — finalScore continuous model", () => {
  it("healthy node, no upstream → finalScore=0.00", () => {
    const n = propagate(makeGraph({ nodes: [makeNode("a", [hCheck()])] })).nodes[0];
    expect(n.finalScore).toBeCloseTo(0.0);
    expect(n.visualStatus).toBe("healthy");
  });

  it("unknown node, no upstream → finalScore=0.00, visualStatus=healthy, reportedStatus=unknown", () => {
    const n = propagate(makeGraph({ nodes: [makeNode("a", [])] })).nodes[0];
    expect(n.finalScore).toBeCloseTo(0.0);
    expect(n.reportedStatus).toBe("unknown");
    expect(n.visualStatus).toBe("healthy");
  });

  it("failing node → finalScore=1.00", () => {
    const n = propagate(makeGraph({ nodes: [makeNode("a", [fCheck()])] })).nodes[0];
    expect(n.finalScore).toBeCloseTo(1.0);
    expect(n.visualStatus).toBe("failing");
  });

  it("healthy node 1 hop from failing → finalScore=0.50", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [fCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const b = propagate(graph).nodes.find((n) => n.id === "b")!;
    expect(b.finalScore).toBeCloseTo(0.5);
    expect(b.visualStatus).toBe("degraded");
  });

  it("healthy node 2 hops from failing → finalScore=0.25", () => {
    const graph = makeGraph({
      nodes: [
        makeNode("a", [fCheck()], "A"),
        makeNode("b", [hCheck()], "B"),
        makeNode("c", [hCheck()], "C"),
      ],
      edges: [
        makeEdge("e1", ["a"], "b", [hCheck()]),
        makeEdge("e2", ["b"], "c", [hCheck()]),
      ],
    });
    const c = propagate(graph).nodes.find((n) => n.id === "c")!;
    expect(c.finalScore).toBeCloseTo(0.25);
    expect(c.visualStatus).toBe("at_risk");
  });

  it("failing node own score floors a weaker upstream (max semantics)", () => {
    // A (unknown) → B (failing): unknown carries score 0, so upstream=0, B stays at 1.0
    const graph = makeGraph({
      nodes: [makeNode("a", [], "A"), makeNode("b", [fCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const b = propagate(graph).nodes.find((n) => n.id === "b")!;
    expect(b.finalScore).toBeCloseTo(1.0);
    expect(b.visualStatus).toBe("failing");
    expect(b.visualReason).toBeNull();
  });
});

// ── Reported vs visual ────────────────────────────────────────────────────────

describe("propagate — reported vs visual", () => {
  it("degraded is output-only: healthy node downstream of failing derives visualStatus 'degraded'", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [fCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    expect(b.reportedStatus).toBe("healthy"); // reported: never degraded
    expect(b.visualStatus).toBe("degraded");  // visual: derived from upstream
  });

  it("keeps reportedStatus unchanged when upstream bumps visualStatus", () => {
    const graph = makeGraph({
      nodes: [makeNode("a", [fCheck()], "A"), makeNode("b", [hCheck()], "B")],
      edges: [makeEdge("e1", ["a"], "b", [hCheck()])],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    expect(b.reportedStatus).toBe("healthy");
    expect(b.visualStatus).toBe("degraded");
  });
});
