import type { ProverPhase } from "@alejoamiras/tee-rex";
import type { UiMode } from "./aztec";

// ── Phase types ──

/** All phases the animation can display — SDK prover phases + app-level phases. */
export type AnimationPhase = ProverPhase | "app:simulate" | "app:prove" | "app:confirm";

// ── Phase queue ──

const MIN_DISPLAY_MS = 1000;

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

function spin(tick: number): string {
  return BRAILLE_SPINNER[tick % BRAILLE_SPINNER.length];
}

// ── Box helpers — auto-pad all rows to the widest line, impossible to misalign ──

type Border = "single" | "double" | "round";

const BORDER_CHARS: Record<
  Border,
  { tl: string; tr: string; bl: string; br: string; h: string; v: string }
> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
};

/**
 * Build a perfectly aligned ASCII box. All rows are auto-padded to the widest
 * content line. Title is embedded in the top border if provided.
 */
function box(lines: string[], border: Border = "single", title?: string): string {
  const b = BORDER_CHARS[border];
  const w = Math.max(...lines.map((l) => l.length));
  const topFill = title
    ? `${b.h} ${title} ${b.h.repeat(Math.max(0, w - title.length - 1))}`
    : b.h.repeat(w + 2);
  return [
    `  ${b.tl}${topFill}${b.tr}`,
    ...lines.map((l) => `  ${b.v} ${l.padEnd(w)} ${b.v}`),
    `  ${b.bl}${b.h.repeat(w + 2)}${b.br}`,
  ].join("\n");
}

// ── Frame generators per (mode, phase) ──

type FrameFn = (tick: number) => string;

function simulateFrames(): FrameFn {
  return (tick) =>
    box(
      [`> simulating tx...    ${spin(tick)}`, `  ${progressBar(tick, 22)}`],
      "round",
      "witness generation",
    );
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
    const rows = lines.map((l, i) => (i < shown ? l : ""));
    return box([...rows, "", `  ${progressBar(tick, 22)}`], "single", "SERIALIZING");
  };
}

function fetchAttestationFrames(mode: "tee" | "remote"): FrameFn {
  const title = mode === "tee" ? "NITRO ATTESTATION" : "SERVER KEY";
  return (tick) =>
    box([`> fetching key...     ${spin(tick)}`, `  ${progressBar(tick, 22)}`], "single", title);
}

function encryptFrames(): FrameFn {
  const plain = ["fn: deploy_account    ", "args: 0x7a2f...3b1c  "];
  const cipher = ["a4F8#kL$mN2&pQ9*rT5^w", "xC7@dG3%jH6(bE0)vI4+z"];
  return (tick) => {
    const progress = Math.min(1, tick / 10);
    const rows = plain.map((p, i) => {
      const c = cipher[i];
      const cut = Math.floor(c.length * progress);
      return c.slice(0, cut) + p.slice(cut);
    });
    const done = progress >= 1 ? "✓" : spin(tick);
    return box([...rows, "", `  AES-256-GCM           ${done}`], "single", "ENCRYPTING");
  };
}

function transmitFrames(mode: "tee" | "remote"): FrameFn {
  const target = mode === "tee" ? "ENCLAVE" : "SERVER";
  const trackW = 24;
  const slots = trackW - 4; // positions for >>> within the track
  return (tick) => {
    const pos = tick % (slots + 1);
    const track = `${"░".repeat(pos)}>>>${"░".repeat(slots - pos)}▸`;
    return box([track, `encrypted payload      ${spin(tick)}`], "single", `SENDING to ${target}`);
  };
}

function provingFramesTee(): FrameFn {
  const steps = ["decrypting payload...", "loading circuits...", "generating zk proof.."];
  return (tick) => {
    const shown = Math.min(steps.length, Math.floor(tick / 8) + 1);
    const rows = steps.map((s, i) => {
      if (i < shown - 1) return `> ${s}  ✓`;
      if (i === shown - 1) return `> ${s}  ${i === steps.length - 1 ? spin(tick) : "✓"}`;
      return "";
    });
    return box(["", ...rows, "", `  ${progressBar(tick, 22)}`, ""], "double", "AWS NITRO ENCLAVE");
  };
}

function provingFramesRemote(): FrameFn {
  const steps = ["deserializing...", "generating zk proof.."];
  return (tick) => {
    const shown = Math.min(steps.length, Math.floor(tick / 8) + 1);
    const rows = steps.map((s, i) => {
      if (i < shown - 1) return `> ${s}       ✓`;
      if (i === shown - 1) return `> ${s}       ${i === steps.length - 1 ? spin(tick) : "✓"}`;
      return "";
    });
    return box(["", ...rows, "", `  ${progressBar(tick, 22)}`, ""], "single", "REMOTE SERVER");
  };
}

function provingFramesLocal(): FrameFn {
  return (tick) => {
    const inner = box(
      [`> generating zk proof ${spin(tick)}`, `  ${progressBar(tick, 22)}`],
      "single",
      "wasm prover",
    );
    // Wrap in outer round box with 1-char padding on each side
    const innerLines = inner.split("\n");
    const w = Math.max(...innerLines.map((l) => l.length)) + 2;
    return [
      `  ╭${"─".repeat(w)}╮`,
      ...innerLines.map((l) => `  │ ${l.padEnd(w - 1)}│`),
      `  ╰${"─".repeat(w)}╯`,
    ].join("\n");
  };
}

function receiveFrames(): FrameFn {
  const cipher = ["a4F8#kL$mN2&pQ9*rT5^w", "xC7@dG3%jH6(bE0)vI4+z"];
  const plain = ["proof: 0xab3f...c712  ", "publicInputs: [42,..]  "];
  return (tick) => {
    const progress = Math.min(1, tick / 10);
    const rows = cipher.map((c, i) => {
      const p = plain[i];
      const cut = Math.floor(p.length * progress);
      return p.slice(0, cut) + c.slice(cut);
    });
    const done = progress >= 1 ? "✓" : spin(tick);
    return box([...rows, "", `  decrypting result      ${done}`], "single", "RECEIVED");
  };
}

function confirmFrames(): FrameFn {
  return (tick) =>
    box([`> broadcasting tx...  ${spin(tick)}`, `  ${progressBar(tick, 22)}`], "round", "proof ✓");
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
  #startTime = 0;
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
    this.#startTime = Date.now();
    this.#el.classList.remove("hidden");
    this.#tick = 0;
    this.#animTimer = setInterval(() => {
      if (this.#frameFn) {
        const elapsed = ((Date.now() - this.#startTime) / 1000).toFixed(1);
        this.#el.textContent = `${this.#frameFn(this.#tick)}\n\n              elapsed ${elapsed}s`;
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
