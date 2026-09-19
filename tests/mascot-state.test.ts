import { describe, expect, it } from "vitest";
import { getCatStatus, getNextMascotTarget } from "../src/lib/mascot-state";

describe("mascot state helpers", () => {
  it("cycles archive targets without leaving the available range", () => {
    expect(getNextMascotTarget(0, 4)).toBe(0);
    expect(getNextMascotTarget(4, 4)).toBe(0);
    expect(getNextMascotTarget(-1, 4)).toBe(3);
    expect(getNextMascotTarget(2, 0)).toBe(0);
  });

  it("keeps assistive status tied to the current mascot state", () => {
    expect(getCatStatus("sleep")).toBe("猫猫正在睡觉");
    expect(getCatStatus("fetching")).toBe("蜘蛛正在整理档案");
    expect(getCatStatus("idle")).toBe("猫猫正在发呆");
  });
});
