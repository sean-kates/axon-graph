import { describe, it, expect } from "vitest";
import { scoreToColor, scoreToGlow, statusToScore, DEFAULT_HEALTH_STOPS } from "./healthColors";

describe("scoreToColor — 3-stop gradient: green → amber → red", () => {
  it("score=0.0 → healthy green", () => {
    expect(scoreToColor(0.0)).toBe("rgb(0,255,136)");
  });

  it("score=0.25 → bright yellow-green (regression: must not be olive/muddy)", () => {
    // t=0.5 in segment [0,0.5]: r=128, g=230, b=68
    expect(scoreToColor(0.25)).toBe("rgb(128,230,68)");
  });

  it("score=0.5 → amber midpoint", () => {
    expect(scoreToColor(0.5)).toBe("rgb(255,204,0)");
  });

  it("score=0.75 → warm orange (regression: must not be olive/muddy)", () => {
    // t=0.5 in segment [0.5,1.0]: r=255, g=128, b=26
    expect(scoreToColor(0.75)).toBe("rgb(255,128,26)");
  });

  it("score=1.0 → failing red", () => {
    expect(scoreToColor(1.0)).toBe("rgb(255,51,51)");
  });

  it("clamps below 0", () => {
    expect(scoreToColor(-0.5)).toBe("rgb(0,255,136)");
  });

  it("clamps above 1", () => {
    expect(scoreToColor(1.5)).toBe("rgb(255,51,51)");
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

describe("DEFAULT_HEALTH_STOPS", () => {
  it("exports the 3-stop palette for user overrides", () => {
    expect(DEFAULT_HEALTH_STOPS).toHaveLength(3);
    expect(DEFAULT_HEALTH_STOPS[0]).toMatchObject({ score: 0.0, r: 0,   g: 255, b: 136 });
    expect(DEFAULT_HEALTH_STOPS[1]).toMatchObject({ score: 0.5, r: 255, g: 204, b: 0   });
    expect(DEFAULT_HEALTH_STOPS[2]).toMatchObject({ score: 1.0, r: 255, g: 51,  b: 51  });
  });
});
