import type { NodeShape } from "../../types";
import type { GraphNode, GraphLink } from "./graphAdapters";
import { scoreToGlow, UNKNOWN_GLOW } from "./healthColors";

const phaseCache = new Map<string, number>();

function getPhase(id: string): number {
  if (!phaseCache.has(id)) phaseCache.set(id, Math.random() * Math.PI * 2);
  return phaseCache.get(id)!;
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: NodeShape,
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
    ? (node.sourceNode.visualStatus === "unknown"
        ? UNKNOWN_GLOW
        : scoreToGlow(node.sourceNode.finalScore))
    : "rgba(80,80,80,0.3)";
  const glowRadius = r * (1.5 + pulse * 0.5);
  const grd = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowRadius);
  grd.addColorStop(0, glowColor);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, 2 * Math.PI);
  ctx.fillStyle = grd;
  ctx.fill();

  const shape = node.sourceNode?.shape ?? "circle";

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

// PULSE_SPEED controls how fast dots travel source→target
// 0.0002 = slow, meditative (good for low-frequency cron jobs)
// 0.0004 = default, feels alive without being distracting
// 0.0008 = fast, urgent (consider for failing edges)
// Could be driven by edge.expectedCadenceSeconds in future
const PULSE_SPEED = 0.0004;

function drawPulse(
  ctx: CanvasRenderingContext2D,
  link: GraphLink,
  globalTime: number
): void {
  const source = link.source as unknown as GraphNode;
  const target = link.target as unknown as GraphNode;
  if (typeof source !== "object" || typeof target !== "object") return;

  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;

  const offsets = [0];

  for (const offset of offsets) {
    const t = (globalTime * PULSE_SPEED + (link.phase ?? 0) + offset) % 1;

    let opacity: number;
    if (link.visualStatus === "failing") {
      // fades out, never arrives — dies at ~60% of the way
      opacity = t < 0.6 ? 1 - t / 0.6 : 0;
    } else if (link.visualStatus === "degraded") {
      // arrives but dims progressively
      opacity = 1 - t * 0.7;
    } else {
      // healthy / at_risk — full brightness the whole way
      opacity = 1;
    }

    if (opacity <= 0) continue;

    const x = sx + (tx - sx) * t;
    const y = sy + (ty - sy) * t;
    const dotRadius = link.visualStatus === "failing" ? 3 : 2;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
    ctx.fillStyle = link.color;
    ctx.shadowColor = link.color;
    ctx.shadowBlur = link.visualStatus === "failing" ? 12 : 6;
    ctx.fill();
    ctx.restore();
  }
}

export function drawLink(
  link: GraphLink,
  ctx: CanvasRenderingContext2D,
  globalTime: number
): void {
  const src = link.source as unknown as GraphNode;
  const tgt = link.target as unknown as GraphNode;
  if (typeof src !== "object" || typeof tgt !== "object") return;

  const sx = src.x ?? 0;
  const sy = src.y ?? 0;
  const tx = tgt.x ?? 0;
  const ty = tgt.y ?? 0;

  // Satellite tether: thin dotted line, no arrowhead, no pulse
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
  ctx.lineWidth = 0.75;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.atan2(ty - sy, tx - sx);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - 8 * Math.cos(angle - 0.4), ty - 8 * Math.sin(angle - 0.4));
  ctx.lineTo(tx - 8 * Math.cos(angle + 0.4), ty - 8 * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = link.color;
  ctx.fill();

  drawPulse(ctx, link, globalTime);
}
