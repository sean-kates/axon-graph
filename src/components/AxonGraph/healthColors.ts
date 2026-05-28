import type { ReportedStatus, VisualStatus } from "../../types";

export const DEFAULT_HEALTH_STOPS = [
  { score: 0.0, r: 0,   g: 255, b: 136 }, // #00ff88 healthy green
  { score: 0.5, r: 255, g: 204, b: 0   }, // #ffcc00 amber
  { score: 1.0, r: 255, g: 51,  b: 51  }, // #ff3333 failing red
];

// Gray used for unknown nodes/edges — outside the health gradient
export const UNKNOWN_COLOR = "rgb(100,100,110)";
export const UNKNOWN_GLOW  = "rgba(100,100,110,0.5)";

export function statusToScore(status: ReportedStatus | VisualStatus): number {
  switch (status) {
    case "failing":  return 1.0;
    case "degraded": return 0.6;
    case "unknown":  return 0.0;
    case "at_risk":  return 0.25;
    case "healthy":  return 0;
  }
}

export function scoreToColor(score: number): string {
  const [r, g, b] = lerpColorRgb(score);
  return `rgb(${r},${g},${b})`;
}

export function scoreToGlow(score: number): string {
  const [r, g, b] = lerpColorRgb(score);
  return `rgba(${r},${g},${b},0.7)`;
}

function lerpColorRgb(score: number): [number, number, number] {
  const stops = DEFAULT_HEALTH_STOPS;
  const s = Math.max(0, Math.min(1, score));

  let lower = stops[0];
  let upper = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i].score && s <= stops[i + 1].score) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const range = upper.score - lower.score;
  const t = range === 0 ? 0 : (s - lower.score) / range;

  return [
    Math.round(lower.r + (upper.r - lower.r) * t),
    Math.round(lower.g + (upper.g - lower.g) * t),
    Math.round(lower.b + (upper.b - lower.b) * t),
  ];
}
