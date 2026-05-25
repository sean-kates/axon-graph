import type { HealthStatus } from "../../types";

export function healthColor(baseColor: string, status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return baseColor;
    case "degraded":
      return blendToward(baseColor, "#B8860B", 0.55);
    case "failing":
      return blendToward(baseColor, "#C0392B", 0.75);
    case "unknown":
      return blendToward(baseColor, "#555555", 0.7);
  }
}

export function healthGlow(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "rgba(100,220,100,0.7)";
    case "degraded":
      return "rgba(200,160,30,0.6)";
    case "failing":
      return "rgba(220,50,50,0.7)";
    case "unknown":
      return "rgba(100,100,100,0.3)";
  }
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

function blendToward(base: string, target: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(base);
  const [r2, g2, b2] = hexToRgb(target);
  return rgbToHex(
    r1 + (r2 - r1) * t,
    g1 + (g2 - g1) * t,
    b1 + (b2 - b1) * t
  );
}
