import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs in jsdom", () => {
    expect(document.body).toBeTruthy();
  });
});