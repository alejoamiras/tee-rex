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

    // Wait for two drain cycles (500ms each + buffer)
    await new Promise((r) => setTimeout(r, 1100));
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
    await new Promise((r) => setTimeout(r, 600));
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

  test("frames change across ticks (proving animation)", () => {
    const fn = getFrameFn("tee", "proving");
    const frame0 = fn(0);
    const frame5 = fn(5);
    expect(frame0).not.toBe(frame5);
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
