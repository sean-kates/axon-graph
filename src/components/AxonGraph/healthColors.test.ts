import { describe, it, expect } from "vitest";
import { scoreToColor, scoreToGlow, statusToScore } from "./healthColors";

// HEALTH_GREEN=#00ff88 (R=0, G=255, B=136)
// HEALTH_RED  =#ff3333 (R=255, G=51, B=51)
// lerp(from, to, t): round(from + (to-from)*t) per channel

describe("scoreToColor — lerp between #00ff88 and #ff3333", () => {
  it("score=0.0 → pure green #00ff88", () => {
    expect(scoreToColor(0.0)).toBe("#00ff88");
  });

  it("score=0.25 → warm yellow-green", () => {
    // R: round(0 + 255*0.25)=64=0x40  G: round(255-204*0.25)=204=0xcc  B: round(136-85*0.25)=115=0x73
    expect(scoreToColor(0.25)).toBe("#40cc73");
  });

  it("score=0.5 → amber midpoint", () => {
    // R: round(255*0.5)=128=0x80  G: round(255-204*0.5)=153=0x99  B: round(136-85*0.5)=94=0x5e
    expect(scoreToColor(0.5)).toBe("#80995e");
  });

  it("score=0.6 → orange (degraded node color)", () => {
    // R: round(255*0.6)=153=0x99  G: round(255-204*0.6)=133=0x85  B: round(136-85*0.6)=85=0x55
    expect(scoreToColor(0.6)).toBe("#998555");
  });

  it("score=1.0 → pure red #ff3333", () => {
    expect(scoreToColor(1.0)).toBe("#ff3333");
  });

  it("clamps below 0", () => {
    expect(scoreToColor(-0.5)).toBe("#00ff88");
  });

  it("clamps above 1", () => {
    expect(scoreToColor(1.5)).toBe("#ff3333");
  });
});

describe("scoreToGlow", () => {
  it("score=0 → rgba from green", () => {
    expect(scoreToGlow(0)).toBe("rgba(0,255,136,0.7)");
  });

  it("score=1 → rgba from red", () => {
    expect(scoreToGlow(1)).toBe("rgba(255,51,51,0.7)");
  });
});

describe("statusToScore", () => {
  it("maps each status to its base score", () => {
    expect(statusToScore("healthy")).toBe(0);
    expect(statusToScore("unknown")).toBe(0.3);
    expect(statusToScore("degraded")).toBe(0.6);
    expect(statusToScore("failing")).toBe(1.0);
  });
});
