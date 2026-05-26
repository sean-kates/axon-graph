import type { HealthStatus } from "../../types";

const HEALTH_GREEN = "#00ff88";
const HEALTH_RED = "#ff3333";

export function statusToScore(status: HealthStatus): number {
  switch (status) {
    case "failing":  return 1.0;
    case "degraded": return 0.6;
    case "unknown":  return 0.3;
    case "healthy":  return 0;
  }
}

export function scoreToColor(score: number): string {
  return lerpHex(HEALTH_GREEN, HEALTH_RED, Math.max(0, Math.min(1, score)));
}

export function scoreToGlow(score: number): string {
  const [r, g, b] = hexToRgb(scoreToColor(score));
  return `rgba(${r},${g},${b},0.7)`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

function lerpHex(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
