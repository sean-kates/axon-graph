import { describe, it, expect } from "vitest";
import { propagate } from "./propagate";
import type { RawGraph } from "../types";

const baseConfig = {
  pollInterval: 30000,
  propagation: { decayFactor: 0.5, maxDepth: 5 },
};

const baseNodeTypes = {
  core: { label: "Core", shape: "hexagon" as const, color: "#4A90D9" },
};

const baseEdgeTypes = {
  cron: { label: "Cron", style: "solid" as const, color: "#888" },
};

function makeGraph(partial: Partial<RawGraph>): RawGraph {
  return {
    config: baseConfig,
    nodeTypes: baseNodeTypes,
    edgeTypes: baseEdgeTypes,
    nodes: [],
    edges: [],
    ...partial,
  };
}

describe("propagate — isolated nodes", () => {
  it("passes through healthy node unchanged", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].visualStatus).toBe("healthy");
    expect(resolved.nodes[0].visualReason).toBeNull();
  });

  it("passes through failing node unchanged", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].visualStatus).toBe("failing");
  });

  it("passes through unknown node unchanged", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "unknown", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    expect(resolved.nodes[0].visualStatus).toBe("unknown");
  });
});

describe("propagate — single upstream failing", () => {
  it("downstream of failing node gets degraded at hop 1 (decayFactor 0.5 → degraded)", () => {
    // A (failing) → B (healthy)
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "job",
          sources: ["a"],
          target: "b",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    expect(b.visualStatus).toBe("degraded");
    expect(b.visualReason).toContain("A");
  });

  it("two hops downstream gets healthy (decayFactor 0.5^2 = 0.25 → no longer degrades)", () => {
    // A (failing) → B → C
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "c",
          label: "C",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "job1",
          sources: ["a"],
          target: "b",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
        {
          id: "e2",
          label: "job2",
          sources: ["b"],
          target: "c",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const c = resolved.nodes.find((n) => n.id === "c")!;
    // 0.5^2 = 0.25, below degraded threshold (0.4), so c stays healthy
    expect(c.visualStatus).toBe("healthy");
  });
});

describe("propagate — maxDepth", () => {
  it("stops propagation at maxDepth", () => {
    // chain of 6 nodes, maxDepth=2
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      label: `N${i}`,
      type: "core",
      size: 1,
      healthRollup: "any" as const,
      health: {
        status: i === 0 ? ("failing" as const) : ("healthy" as const),
        updatedAt: "",
        checks: [],
      },
      meta: {},
    }));
    const edges = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      label: `job${i}`,
      sources: [`n${i}`],
      target: `n${i + 1}`,
      type: "cron",
      health: { status: "healthy" as const, checks: [] },
      meta: {},
    }));
    const graph = makeGraph({
      config: {
        ...baseConfig,
        propagation: { decayFactor: 0.9, maxDepth: 2 },
      },
      nodes,
      edges,
    });
    const resolved = propagate(graph);
    // n3, n4, n5 are beyond maxDepth=2, should remain healthy
    expect(resolved.nodes.find((n) => n.id === "n3")!.visualStatus).toBe(
      "healthy"
    );
    expect(resolved.nodes.find((n) => n.id === "n4")!.visualStatus).toBe(
      "healthy"
    );
    expect(resolved.nodes.find((n) => n.id === "n5")!.visualStatus).toBe(
      "healthy"
    );
  });
});

describe("propagate — fan-in edges", () => {
  it("node with fan-in takes worst upstream influence", () => {
    // A (failing) and B (healthy) both write to C
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "c",
          label: "C",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "fan_in_job",
          sources: ["a", "b"],
          target: "c",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const c = resolved.nodes.find((n) => n.id === "c")!;
    expect(c.visualStatus).toBe("degraded");
  });
});

describe("propagate — healthRollup", () => {
  it("healthRollup=all: node with one failing check but others healthy stays degraded not failing", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "all",
          health: {
            status: "degraded",
            updatedAt: "",
            checks: [
              {
                name: "check1",
                status: "failing",
                message: "",
                checkedAt: "",
              },
              {
                name: "check2",
                status: "healthy",
                message: "",
                checkedAt: "",
              },
            ],
          },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    // reportedStatus from health.status is degraded, visualStatus stays degraded (no upstream)
    expect(resolved.nodes[0].visualStatus).toBe("degraded");
  });
});

describe("propagate — edge visualStatus", () => {
  it("edge inherits degraded status when source node is failing", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "job",
          sources: ["a"],
          target: "b",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const edge = resolved.edges.find((e) => e.id === "e1")!;
    // Edge leaving a failing source should reflect that
    expect(edge.visualStatus).not.toBe("healthy");
  });

  it("edge with own failing health shows failing", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "job",
          sources: ["a"],
          target: "b",
          type: "cron",
          health: { status: "failing", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const edge = resolved.edges.find((e) => e.id === "e1")!;
    expect(edge.visualStatus).toBe("failing");
  });
});

describe("propagate — reported vs visual", () => {
  it("keeps reportedStatus (health.status) unchanged", () => {
    const graph = makeGraph({
      nodes: [
        {
          id: "a",
          label: "A",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "failing", updatedAt: "", checks: [] },
          meta: {},
        },
        {
          id: "b",
          label: "B",
          type: "core",
          size: 1,
          healthRollup: "any",
          health: { status: "healthy", updatedAt: "", checks: [] },
          meta: {},
        },
      ],
      edges: [
        {
          id: "e1",
          label: "job",
          sources: ["a"],
          target: "b",
          type: "cron",
          health: { status: "healthy", checks: [] },
          meta: {},
        },
      ],
    });
    const resolved = propagate(graph);
    const b = resolved.nodes.find((n) => n.id === "b")!;
    // reportedStatus unchanged
    expect(b.health.status).toBe("healthy");
    // visualStatus reflects upstream
    expect(b.visualStatus).toBe("degraded");
  });
});
