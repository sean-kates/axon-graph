import type { ResolvedGraph } from "../../types";
import type { GraphNode, GraphLink } from "./graphAdapters";
import { healthGlow } from "./healthColors";

const phaseCache = new Map<string, number>();

function getPhase(id: string): number {
  if (!phaseCache.has(id)) phaseCache.set(id, Math.random() * Math.PI * 2);
  return phaseCache.get(id)!;
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  r: number
): void {
  switch (shape) {
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        i === 0
          ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
          : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "square":
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

export function drawNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  frameTime: number,
  resolvedGraph: ResolvedGraph | null,
  globalScale: number = 1
): void {
  const t = frameTime + getPhase(node.id);
  const pulse = Math.sin(t) * 0.15 + 0.85;
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  if (node.isSatellite) {
    ctx.beginPath();
    ctx.arc(x, y, node.nodeSize / 2, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.fill();
    return;
  }

  const r = node.nodeSize;
  const glowColor = node.sourceNode
    ? healthGlow(node.sourceNode.visualStatus)
    : "rgba(80,80,80,0.3)";
  const glowRadius = r * (1.5 + pulse * 0.5);
  const grd = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowRadius);
  grd.addColorStop(0, glowColor);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, 2 * Math.PI);
  ctx.fillStyle = grd;
  ctx.fill();

  const shape =
    node.sourceNode && resolvedGraph
      ? (resolvedGraph.nodeTypes[node.sourceNode.type]?.shape ?? "circle")
      : "circle";

  ctx.beginPath();
  drawShape(ctx, shape, x, y, r * pulse);
  ctx.fillStyle = node.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Keep label at a fixed screen size regardless of zoom level.
  const fontSize = Math.max(1, 11 / globalScale);
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(node.label, x, y + r + fontSize * 0.8);
}

export function drawLink(
  link: GraphLink,
  ctx: CanvasRenderingContext2D,
  frameTime: number
): void {
  const src = link.source as unknown as GraphNode;
  const tgt = link.target as unknown as GraphNode;
  if (typeof src !== "object" || typeof tgt !== "object") return;

  const sx = src.x ?? 0;
  const sy = src.y ?? 0;
  const tx = tgt.x ?? 0;
  const ty = tgt.y ?? 0;

  // Satellite tether: thin dotted line, no arrowhead
  if (link.isTether) {
    ctx.strokeStyle = link.color;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  ctx.strokeStyle = link.color;
  ctx.lineWidth = 1.5;

  if (link.style === "dashed") {
    ctx.setLineDash([6, 4]);
  } else if (link.style === "animated") {
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -(frameTime * 3) % 20;
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  if (!link.isSynthetic) {
    const angle = Math.atan2(ty - sy, tx - sx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 8 * Math.cos(angle - 0.4), ty - 8 * Math.sin(angle - 0.4));
    ctx.lineTo(tx - 8 * Math.cos(angle + 0.4), ty - 8 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = link.color;
    ctx.fill();
  }
}
