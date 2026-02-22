import type { ProverPhase } from "@alejoamiras/tee-rex";
import type { UiMode } from "./aztec";

// ── Phase types ──

/** All phases the animation can display — SDK prover phases + app-level phases. */
export type AnimationPhase = ProverPhase | "app:simulate" | "app:prove" | "app:confirm";

// ── Phase queue ──

const MIN_DISPLAY_MS = 500;

/**
 * Buffers fast phases with a minimum display time so users can see each one.
 * When the queue empties on a long-running phase, it stays displayed until the next push.
 */
export class PhaseQueue {
  #queue: AnimationPhase[] = [];
  #current: AnimationPhase | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onChange: (phase: AnimationPhase) => void;

  constructor(onChange: (phase: AnimationPhase) => void) {
    this.#onChange = onChange;
  }

  get current(): AnimationPhase | null {
    return this.#current;
  }

  push(phase: AnimationPhase): void {
    if (this.#current === null) {
      // First phase — display immediately
      this.#current = phase;
      this.#onChange(phase);
      this.#scheduleNext();
    } else {
      this.#queue.push(phase);
      this.#scheduleNext(); // Ensure drain timer is running
    }
  }

  #scheduleNext(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const next = this.#queue.shift();
      if (next) {
        this.#current = next;
        this.#onChange(next);
        this.#scheduleNext();
      }
      // If queue is empty, stay on current phase
    }, MIN_DISPLAY_MS);
  }

  clear(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#queue = [];
    this.#current = null;
  }
}

// ── ASCII frames ──

const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function progressBar(tick: number, width: number): string {
  const filled = Math.min(width, Math.floor((tick % (width * 3)) / 3));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function spinner(tick: number): string {
  return BRAILLE_SPINNER[tick % BRAILLE_SPINNER.length];
}

// ── Frame generators per (mode, phase) ──

type FrameFn = (tick: number) => string;

function simulateFrames(): FrameFn {
  return (tick) => {
    const s = spinner(tick);
    return [
      "  ╭─── witness generation ───╮",
      `  │  > simulating tx...    ${s} │`,
      `  │    ${progressBar(tick, 22)} │`,
      "  ╰──────────────────────────╯",
    ].join("\n");
  };
}

function serializeFrames(): FrameFn {
  const lines = [
    "fn: deploy_account",
    "args: 0x7a2f...3b1c",
    "witness: Map(42)",
    "bytecode: 1.2MB",
  ];
  return (tick) => {
    const shown = Math.min(lines.length, Math.floor(tick / 2) + 1);
    const rows = lines.slice(0, shown).map((l) => `  │ ${l.padEnd(26)}│`);
    while (rows.length < lines.length) rows.push(`  │${" ".repeat(27)}│`);
    return [
      "  ┌─ SERIALIZING ────────────┐",
      ...rows,
      `  │    ${progressBar(tick, 22)} │`,
      "  └────────────────────────────┘",
    ].join("\n");
  };
}

function fetchAttestationFrames(mode: "tee" | "remote"): FrameFn {
  const label = mode === "tee" ? "NITRO ATTESTATION" : "SERVER KEY";
  return (tick) => {
    const s = spinner(tick);
    return [
      `  ┌─ ${label.padEnd(23)}┐`,
      `  │  > fetching key...    ${s} │`,
      `  │    ${progressBar(tick, 22)} │`,
      "  └────────────────────────────┘",
    ].join("\n");
  };
}

function encryptFrames(): FrameFn {
  const plain = ["fn: deploy_account     ", "args: 0x7a2f...3b1c   "];
  const cipher = ["a4F8#kL$mN2&pQ9*rT5^w", "xC7@dG3%jH6(bE0)vI4+z"];
  return (tick) => {
    const progress = Math.min(1, tick / 8);
    const rows = plain.map((p, i) => {
      const c = cipher[i];
      const cut = Math.floor(p.length * progress);
      return c.slice(0, cut) + p.slice(cut);
    });
    const done = progress >= 1 ? " ✓" : "  ";
    return [
      "  ┌─ ENCRYPTING ─────────────┐",
      ...rows.map((r) => `  │ ${r} │`),
      `  │    AES-256-GCM         ${done} │`,
      "  └────────────────────────────┘",
    ].join("\n");
  };
}

function transmitFrames(mode: "tee" | "remote"): FrameFn {
  const target = mode === "tee" ? "ENCLAVE" : "SERVER";
  const width = 20;
  return (tick) => {
    const pos = Math.min(width, Math.floor(tick % (width + 4)));
    const line = `${" ".repeat(pos)}>>>${" ".repeat(Math.max(0, width - pos))}`;
    return [
      `                       ╔══ ${target} ══╗`,
      `  ${line}║          ║`,
      `                       ╚═══════════╝`,
    ].join("\n");
  };
}

function provingFramesTee(): FrameFn {
  const logLines = [
    "> decrypting payload...",
    "> loading circuits...  ",
    "> generating zk proof..",
  ];
  return (tick) => {
    const shown = Math.min(logLines.length, Math.floor(tick / 6) + 1);
    const rows: string[] = [];
    for (let i = 0; i < logLines.length; i++) {
      if (i < shown - 1) {
        rows.push(`  ║  ${logLines[i]}  ✓   ║`);
      } else if (i === shown - 1) {
        const s = i === logLines.length - 1 ? spinner(tick) : "✓";
        rows.push(`  ║  ${logLines[i]}  ${s}   ║`);
      } else {
        rows.push(`  ║${" ".repeat(29)}║`);
      }
    }
    return [
      "  ╔═══════════════════════════════╗",
      "  ║  AWS NITRO ENCLAVE            ║",
      "  ║                               ║",
      ...rows,
      `  ║    ${progressBar(tick, 22)}   ║`,
      "  ║                               ║",
      "  ╚═══════════════════════════════╝",
    ].join("\n");
  };
}

function provingFramesRemote(): FrameFn {
  const logLines = ["> deserializing...     ", "> generating zk proof.."];
  return (tick) => {
    const shown = Math.min(logLines.length, Math.floor(tick / 6) + 1);
    const rows: string[] = [];
    for (let i = 0; i < logLines.length; i++) {
      if (i < shown - 1) {
        rows.push(`  │  ${logLines[i]}  ✓  │`);
      } else if (i === shown - 1) {
        const s = i === logLines.length - 1 ? spinner(tick) : "✓";
        rows.push(`  │  ${logLines[i]}  ${s}  │`);
      } else {
        rows.push(`  │${" ".repeat(28)}│`);
      }
    }
    return [
      "  ┌──────────────────────────────┐",
      "  │  REMOTE SERVER               │",
      "  │                              │",
      ...rows,
      `  │    ${progressBar(tick, 22)}  │`,
      "  │                              │",
      "  └──────────────────────────────┘",
    ].join("\n");
  };
}

function provingFramesLocal(): FrameFn {
  return (tick) => {
    const s = spinner(tick);
    return [
      "  ╭────── local machine ──────────╮",
      "  │  ┌──── wasm prover ─────────┐ │",
      `  │  │  > generating zk proof ${s} │ │`,
      `  │  │    ${progressBar(tick, 22)}  │ │`,
      "  │  └──────────────────────────┘ │",
      "  ╰───────────────────────────────╯",
    ].join("\n");
  };
}

function receiveFrames(): FrameFn {
  return () => ["", "         proof ✓ — complete", ""].join("\n");
}

function confirmFrames(): FrameFn {
  return (tick) => {
    const s = spinner(tick);
    return [
      "",
      `  proof ✓ ─── broadcasting tx ──▸ ${s}`,
      `              ${progressBar(tick, 20)}`,
      "",
    ].join("\n");
  };
}

/** Return the frame generator for a given (mode, phase) combination. */
export function getFrameFn(mode: UiMode, phase: AnimationPhase): FrameFn {
  switch (phase) {
    case "app:simulate":
      return simulateFrames();
    case "serialize":
      return serializeFrames();
    case "fetch-attestation":
      return fetchAttestationFrames(mode === "tee" ? "tee" : "remote");
    case "encrypt":
      return encryptFrames();
    case "transmit":
      return transmitFrames(mode === "tee" ? "tee" : "remote");
    case "proving":
      if (mode === "tee") return provingFramesTee();
      if (mode === "remote") return provingFramesRemote();
      return provingFramesLocal();
    case "receive":
      return receiveFrames();
    case "app:prove":
      if (mode === "tee") return provingFramesTee();
      if (mode === "remote") return provingFramesRemote();
      return provingFramesLocal();
    case "app:confirm":
      return confirmFrames();
  }
}

// ── Controller ──

const FRAME_INTERVAL_MS = 100;

export class AsciiController {
  #el: HTMLElement;
  #mode: UiMode = "local";
  #queue: PhaseQueue;
  #frameFn: FrameFn | null = null;
  #tick = 0;
  #animTimer: ReturnType<typeof setInterval> | null = null;

  constructor(el: HTMLElement) {
    this.#el = el;
    this.#queue = new PhaseQueue((phase) => {
      this.#frameFn = getFrameFn(this.#mode, phase);
      this.#tick = 0;
    });
  }

  start(mode: UiMode): void {
    this.#mode = mode;
    this.#el.classList.remove("hidden");
    this.#tick = 0;
    this.#animTimer = setInterval(() => {
      if (this.#frameFn) {
        this.#el.textContent = this.#frameFn(this.#tick);
        this.#tick++;
      }
    }, FRAME_INTERVAL_MS);
  }

  pushPhase(phase: AnimationPhase): void {
    this.#queue.push(phase);
  }

  stop(): void {
    if (this.#animTimer) {
      clearInterval(this.#animTimer);
      this.#animTimer = null;
    }
    this.#queue.clear();
    this.#frameFn = null;
    this.#el.classList.add("hidden");
    this.#el.textContent = "";
  }
}
