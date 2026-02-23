import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type AnimationPhase, AsciiController, getFrameFn, PhaseQueue } from "./ascii-animation";
import type { UiMode } from "./aztec";

describe("PhaseQueue", () => {
  test("first push is displayed immediately", () => {
    const phases: AnimationPhase[] = [];
    const queue = new PhaseQueue((p) => phases.push(p));
    queue.push("serialize");
    expect(phases).toEqual(["serialize"]);
    expect(queue.current).toBe("serialize");
    queue.clear();
  });

  test("queued phases drain in order", async () => {
    const phases: AnimationPhase[] = [];
    const queue = new PhaseQueue((p) => phases.push(p));
    queue.push("serialize");
    queue.push("encrypt");
    queue.push("transmit");
    expect(phases).toEqual(["serialize"]);

    // Wait for two drain cycles (1000ms each + buffer)
    await new Promise((r) => setTimeout(r, 2200));
    expect(phases).toEqual(["serialize", "encrypt", "transmit"]);
    queue.clear();
  });

  test("clear resets state", () => {
    const phases: AnimationPhase[] = [];
    const queue = new PhaseQueue((p) => phases.push(p));
    queue.push("proving");
    queue.push("receive");
    queue.clear();
    expect(queue.current).toBeNull();
  });

  test("stays on current phase when queue is empty", async () => {
    const phases: AnimationPhase[] = [];
    const queue = new PhaseQueue((p) => phases.push(p));
    queue.push("proving");
    // Wait past the min display time — should not emit anything new
    await new Promise((r) => setTimeout(r, 1100));
    expect(phases).toEqual(["proving"]);
    expect(queue.current).toBe("proving");
    queue.clear();
  });
});

describe("getFrameFn", () => {
  const allModes: UiMode[] = ["local", "remote", "tee"];
  const allPhases: AnimationPhase[] = [
    "app:simulate",
    "serialize",
    "fetch-attestation",
    "encrypt",
    "transmit",
    "proving",
    "receive",
    "app:prove",
    "app:confirm",
  ];

  for (const mode of allModes) {
    for (const phase of allPhases) {
      test(`(${mode}, ${phase}) returns non-empty string`, () => {
        const fn = getFrameFn(mode, phase);
        const frame = fn(0);
        expect(typeof frame).toBe("string");
        expect(frame.length).toBeGreaterThan(0);
      });
    }
  }

  test("box frames have consistent line widths", () => {
    // Phases that render boxes (not free-form like transmit/confirm)
    const boxPhases: [UiMode, AnimationPhase][] = [
      ["tee", "app:simulate"],
      ["tee", "serialize"],
      ["tee", "fetch-attestation"],
      ["tee", "encrypt"],
      ["tee", "proving"],
      ["tee", "receive"],
      ["remote", "proving"],
      ["local", "proving"],
    ];
    for (const [mode, phase] of boxPhases) {
      const fn = getFrameFn(mode, phase);
      const frame = fn(5);
      const lines = frame.split("\n").filter((l) => l.length > 0);
      const widths = lines.map((l) => l.length);
      const maxW = Math.max(...widths);
      for (let i = 0; i < lines.length; i++) {
        expect(widths[i]).toBe(maxW);
      }
    }
  });

  test("frames change across ticks (proving animation)", () => {
    const fn = getFrameFn("tee", "proving");
    const frame0 = fn(0);
    const frame5 = fn(5);
    expect(frame0).not.toBe(frame5);
  });

  test("proving stage 2 (morph) differs from stage 1 (inputs)", () => {
    const fn = getFrameFn("tee", "proving");
    const stage1 = fn(5);
    const stage2 = fn(20);
    expect(stage1).not.toBe(stage2);
  });

  test("proving stage 3 contains proof and public_inputs", () => {
    const fn = getFrameFn("tee", "proving");
    // tick=38: crystallizing (proofProgress=0.8), before shimmer kicks in at tick≥40
    const frame = fn(38);
    expect(frame).toContain("proof:");
    expect(frame).toContain("public_inputs:");
  });

  test("proving shimmer keeps proof lines animated after crystallization", () => {
    const fn = getFrameFn("tee", "proving");
    const frame50 = fn(50);
    const frame55 = fn(55);
    // Shimmer + scrolling cipher causes frames to differ even after crystallization
    expect(frame50).not.toBe(frame55);
  });

  test("proving alignment across all stages and modes", () => {
    const modes: UiMode[] = ["tee", "remote", "local"];
    const ticks = [0, 5, 15, 25, 35, 50];
    for (const mode of modes) {
      const fn = getFrameFn(mode, "proving");
      for (const tick of ticks) {
        const frame = fn(tick);
        const lines = frame.split("\n").filter((l) => l.length > 0);
        const widths = lines.map((l) => l.length);
        const maxW = Math.max(...widths);
        for (let i = 0; i < lines.length; i++) {
          if (widths[i] !== maxW) {
            throw new Error(
              `mode=${mode} tick=${tick} line=${i}: width ${widths[i]} !== ${maxW}\n"${lines[i]}"`,
            );
          }
        }
      }
    }
  });

  test("app:prove produces identical frames to proving", () => {
    const modes: UiMode[] = ["tee", "remote", "local"];
    for (const mode of modes) {
      const provingFn = getFrameFn(mode, "proving");
      const appProveFn = getFrameFn(mode, "app:prove");
      for (const tick of [0, 10, 30, 50]) {
        expect(provingFn(tick)).toBe(appProveFn(tick));
      }
    }
  });
});

describe("AsciiController", () => {
  let el: HTMLPreElement;

  beforeEach(() => {
    el = document.createElement("pre");
    el.id = "ascii-art";
    el.classList.add("hidden");
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("start shows element and stop hides it", () => {
    const ctrl = new AsciiController(el);
    ctrl.start("local");
    expect(el.classList.contains("hidden")).toBe(false);
    ctrl.stop();
    expect(el.classList.contains("hidden")).toBe(true);
    expect(el.textContent).toBe("");
  });

  test("pushPhase renders frame content", async () => {
    const ctrl = new AsciiController(el);
    ctrl.start("tee");
    ctrl.pushPhase("proving");

    // Wait for one animation frame (100ms interval)
    await new Promise((r) => setTimeout(r, 150));
    expect(el.textContent!.length).toBeGreaterThan(0);
    expect(el.textContent).toContain("NITRO ENCLAVE");
    ctrl.stop();
  });

  test("stop clears content and timers", async () => {
    const ctrl = new AsciiController(el);
    ctrl.start("remote");
    ctrl.pushPhase("proving");
    await new Promise((r) => setTimeout(r, 150));
    ctrl.stop();
    expect(el.textContent).toBe("");
    // Ensure no more updates after stop
    const snapshot = el.textContent;
    await new Promise((r) => setTimeout(r, 200));
    expect(el.textContent).toBe(snapshot);
  });
});
