import "./style.css";
import { type AnimationPhase, AsciiController } from "./ascii-animation";
import {
  AZTEC_DISPLAY_URL,
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  deployTestAccount,
  ENV_NAME,
  initializeWallet,
  OTHER_ENV_NAME,
  OTHER_ENV_URL,
  PROVER_CONFIGURED,
  PROVER_DISPLAY_URL,
  runTokenFlow,
  type StepTiming,
  setUiMode,
  state,
  TEE_CONFIGURED,
  TEE_DISPLAY_URL,
  type UiMode,
} from "./aztec";
import { $, $btn, appendLog, formatDuration, setStatus, startClock } from "./ui";

let deploying = false;
const runCount: Record<string, number> = { local: 0, remote: 0, tee: 0 };

// ── Clock ──
startClock();

// ── Environment indicator ──
if (ENV_NAME) {
  const indicator = $("env-indicator");
  indicator.classList.remove("hidden");

  const badge = $("env-badge");
  badge.textContent = ENV_NAME;
  badge.className =
    ENV_NAME === "devnet"
      ? "text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 border rounded border-amber-700/50 text-amber-500 bg-amber-900/20"
      : "text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 border rounded border-emerald-700/50 text-emerald-500 bg-emerald-900/20";

  if (OTHER_ENV_URL && OTHER_ENV_NAME) {
    const link = $("env-switch") as HTMLAnchorElement;
    link.href = OTHER_ENV_URL;
    link.textContent = `switch to ${OTHER_ENV_NAME} →`;
  }
}

// ── Service checks ──
async function checkServices(): Promise<{ aztec: boolean; teerex: boolean }> {
  const aztec = await checkAztecNode();
  setStatus("aztec-status", aztec);

  let teerex = false;
  if (PROVER_CONFIGURED) {
    $btn("mode-remote").disabled = false;
    teerex = await checkTeeRexServer();
    setStatus("teerex-status", teerex);
    $("teerex-label").textContent = teerex ? "available" : "unavailable";
  }

  return { aztec, teerex };
}

// ── Mode toggle ──
const INACTIVE_BTN =
  "mode-btn flex-1 py-2.5 px-4 text-xs font-medium uppercase tracking-wider border transition-all duration-150 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400";
const ACTIVE_BTN =
  "mode-btn flex-1 py-2.5 px-4 text-xs font-medium uppercase tracking-wider border transition-all duration-150 mode-active";

function updateModeUI(mode: UiMode): void {
  const buttons: Record<UiMode, HTMLElement> = {
    local: $("mode-local"),
    remote: $("mode-remote"),
    tee: $("mode-tee"),
  };

  for (const [key, btn] of Object.entries(buttons)) {
    btn.className = key === mode ? ACTIVE_BTN : INACTIVE_BTN;
  }
}

$("mode-local").addEventListener("click", () => {
  if (deploying) return;
  setUiMode("local");
  updateModeUI("local");
  appendLog("Switched to local proving mode");
});

$("mode-remote").addEventListener("click", () => {
  if (deploying || $btn("mode-remote").disabled) return;
  setUiMode("remote");
  updateModeUI("remote");
  appendLog("Switched to remote proving mode");
});

$("mode-tee").addEventListener("click", () => {
  if (deploying || $btn("mode-tee").disabled) return;
  setUiMode("tee");
  updateModeUI("tee");
  appendLog("Switched to TEE proving mode");
});

// ── Shared helpers ──
function setActionButtonsDisabled(disabled: boolean): void {
  $btn("deploy-btn").disabled = disabled;
  $btn("token-flow-btn").disabled = disabled;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Shorten "ContractName:function_name" → "function_name" */
function shortFnName(name: string): string {
  if (!name) return "unknown";
  const i = name.lastIndexOf(":");
  return i >= 0 && i < name.length - 1 ? name.slice(i + 1) : name;
}

/** Build a "label ··· value" row using safe DOM APIs (no innerHTML). */
function buildDotRow(
  className: string,
  label: string,
  labelClass: string,
  value: string,
  valueClass: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = className;

  const labelSpan = document.createElement("span");
  labelSpan.className = labelClass;
  labelSpan.textContent = label;

  const dots = document.createElement("span");
  dots.className = "step-dots";

  const valueSpan = document.createElement("span");
  valueSpan.className = valueClass;
  valueSpan.textContent = value;

  row.append(labelSpan, dots, valueSpan);
  return row;
}

function renderSteps(container: HTMLElement, steps: StepTiming[]): void {
  container.replaceChildren();
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `${steps.length} steps`;
  details.appendChild(summary);

  const list = document.createElement("div");
  list.className = "mt-1.5 space-y-1.5";

  for (const step of steps) {
    const group = document.createElement("div");

    // Step header row
    group.appendChild(
      buildDotRow(
        "step-row",
        step.step,
        "text-gray-300",
        formatMs(step.durationMs),
        "text-emerald-500/80 tabular-nums",
      ),
    );

    // Sub-phase details (simulation + prove/send + confirm)
    if (step.simulation || step.proveSendMs != null) {
      const sub = document.createElement("div");
      sub.className = "step-sim";

      // Simulation sub-details
      if (step.simulation) {
        const sim = step.simulation;
        sub.appendChild(
          buildDotRow(
            "step-sim-row",
            "sim",
            "text-gray-600",
            formatMs(sim.totalMs),
            "tabular-nums",
          ),
        );
        sub.appendChild(
          buildDotRow(
            "step-sim-row",
            "sync",
            "text-gray-600",
            formatMs(sim.syncMs),
            "tabular-nums",
          ),
        );
        for (const fn of sim.perFunction) {
          sub.appendChild(
            buildDotRow(
              "step-sim-row",
              shortFnName(fn.name),
              "text-gray-600",
              formatMs(fn.ms),
              "tabular-nums",
            ),
          );
        }
      }

      // Prove + send / confirm sub-rows
      if (step.proveSendMs != null) {
        sub.appendChild(
          buildDotRow(
            "step-sim-row",
            "prove + send",
            "text-gray-600",
            formatMs(step.proveSendMs),
            "tabular-nums",
          ),
        );
      }

      if (step.confirmMs != null) {
        sub.appendChild(
          buildDotRow(
            "step-sim-row",
            "confirm",
            "text-gray-600",
            formatMs(step.confirmMs),
            "tabular-nums",
          ),
        );
      }

      group.appendChild(sub);
    }

    list.appendChild(group);
  }

  details.appendChild(list);
  container.appendChild(details);
  container.classList.remove("hidden");
}

function showResult(mode: UiMode, durationMs: number, tag: string, steps?: StepTiming[]): void {
  $("results").classList.remove("hidden");
  const suffix = mode;

  const timeEl = $(`time-${suffix}`);
  timeEl.textContent = formatDuration(durationMs);
  timeEl.className = "text-3xl font-bold tabular-nums text-emerald-400";

  const tagEl = $(`tag-${suffix}`);
  tagEl.textContent = tag;
  tagEl.className = `mt-1.5 text-[10px] uppercase tracking-widest ${
    tag === "token flow"
      ? "text-cyan-500/70"
      : tag === "cold"
        ? "text-amber-500/70"
        : "text-cyan-500/70"
  }`;

  $(`result-${suffix}`).classList.add("result-filled");

  if (steps?.length) {
    renderSteps($(`steps-${suffix}`), steps);
  }
}

// ── ASCII animation helpers ──
/** Map onStep step names to app-level animation phases. */
function stepToPhase(stepName: string): AnimationPhase | null {
  if (stepName.includes("simulat")) return "app:simulate";
  if (stepName.includes("proving") || stepName.includes("deploying")) return "app:prove";
  if (stepName.includes("confirm")) return "app:confirm";
  return null;
}

// ── Deploy ──
$("deploy-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("deploy-btn");
  btn.textContent = "Proving...";

  $("progress").classList.remove("hidden");
  $("elapsed-time").textContent = "0.0s";

  const ascii = new AsciiController($("ascii-art"));
  ascii.start(state.uiMode);

  try {
    const result = await deployTestAccount(
      appendLog,
      (elapsedMs) => {
        $("elapsed-time").textContent = formatDuration(elapsedMs);
      },
      (stepName) => {
        $("progress-text").textContent = `${stepName}...`;
        const phase = stepToPhase(stepName);
        if (phase) ascii.pushPhase(phase);
      },
      (phase) => ascii.pushPhase(phase),
    );

    appendLog("--- step breakdown ---");
    for (const step of result.steps) {
      appendLog(`  ${step.step}: ${formatDuration(step.durationMs)}`);
    }
    appendLog(`  total: ${formatDuration(result.totalDurationMs)}`);

    runCount[result.mode]++;
    const isCold = runCount[result.mode] === 1;
    showResult(result.mode, result.totalDurationMs, isCold ? "cold" : "warm", result.steps);
  } catch (err) {
    appendLog(`Deploy failed: ${err}`, "error");
  } finally {
    ascii.stop();
    deploying = false;
    setActionButtonsDisabled(false);
    btn.textContent = "Deploy Test Account";
    $("progress").classList.add("hidden");
  }
});

// ── Token Flow ──
$("token-flow-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("token-flow-btn");
  btn.textContent = "Running...";

  $("progress").classList.remove("hidden");
  $("elapsed-time").textContent = "0.0s";

  const ascii = new AsciiController($("ascii-art"));
  ascii.start(state.uiMode);

  try {
    const result = await runTokenFlow(
      appendLog,
      (elapsedMs) => {
        $("elapsed-time").textContent = formatDuration(elapsedMs);
      },
      (stepName) => {
        $("progress-text").textContent = `${stepName}...`;
        const phase = stepToPhase(stepName);
        if (phase) ascii.pushPhase(phase);
      },
      (phase) => ascii.pushPhase(phase),
    );

    appendLog("--- step breakdown ---");
    for (const step of result.steps) {
      appendLog(`  ${step.step}: ${formatDuration(step.durationMs)}`);
    }
    appendLog(`  total: ${formatDuration(result.totalDurationMs)}`);

    showResult(result.mode, result.totalDurationMs, "token flow", result.steps);
  } catch (err) {
    appendLog(`Token flow failed: ${err}`, "error");
  } finally {
    ascii.stop();
    deploying = false;
    setActionButtonsDisabled(false);
    btn.textContent = "Run Token Flow";
    $("progress").classList.add("hidden");
  }
});

// ── Init ──
async function init(): Promise<void> {
  $("aztec-url").textContent = AZTEC_DISPLAY_URL;
  if (PROVER_CONFIGURED) {
    $("teerex-url").textContent = PROVER_DISPLAY_URL;
  }

  appendLog("Checking services...");
  const { aztec, teerex } = await checkServices();

  if (PROVER_CONFIGURED && !teerex) {
    appendLog("TEE-Rex server not reachable — remote proving unavailable", "warn");
  }

  // Auto-configure TEE when env var is set (display URL + check attestation)
  // Runs regardless of Aztec node status — service checks are independent.
  if (TEE_CONFIGURED) {
    $("tee-url").textContent = TEE_DISPLAY_URL;
    appendLog(`TEE_URL configured (${TEE_DISPLAY_URL}) — checking attestation...`);
    const attestation = await checkTeeAttestation("/tee");
    if (attestation.reachable) {
      setStatus("tee-status", attestation.mode === "nitro");
      $("tee-attestation-label").textContent =
        attestation.mode === "nitro" ? "attested" : `attestation: ${attestation.mode ?? "unknown"}`;
      if (attestation.mode === "nitro") {
        $btn("mode-tee").disabled = false;
      }
      appendLog(
        `TEE attestation: ${attestation.mode ?? "unknown"}`,
        attestation.mode === "nitro" ? "success" : "warn",
      );
    } else {
      setStatus("tee-status", false);
      $("tee-attestation-label").textContent = "unreachable";
      appendLog(`TEE server unreachable at ${TEE_DISPLAY_URL}`, "warn");
    }
  }

  if (!aztec) {
    appendLog(`Aztec node not reachable at ${AZTEC_DISPLAY_URL}`, "error");
    appendLog("Start the Aztec node before using the demo", "warn");
    $("wallet-state").textContent = "aztec unavailable";
    setStatus("wallet-dot", false);
    return;
  }

  appendLog("Initializing wallet...");
  $("wallet-state").textContent = "initializing...";
  setStatus("wallet-dot", null);

  const ok = await initializeWallet(appendLog);
  if (ok) {
    $("wallet-state").textContent = "ready";
    $("wallet-state").className = "text-emerald-500/80 ml-auto font-light";
    setStatus("wallet-dot", true);
    setActionButtonsDisabled(false);

    const networkLabel = $("network-label");
    if (state.proofsRequired) {
      networkLabel.textContent = "proofs enabled";
      networkLabel.className = "text-amber-500/80 text-[10px] uppercase tracking-wider ml-2";
      appendLog("Ready — deploy a test account to get started (proofs enabled)", "success");
    } else {
      networkLabel.textContent = "proofs simulated";
      networkLabel.className = "text-gray-600 text-[10px] uppercase tracking-wider ml-2";
      appendLog("Ready — deploy a test account or run the token flow", "success");
    }
  } else {
    $("wallet-state").textContent = "failed";
    $("wallet-state").className = "text-red-400/80 ml-auto font-light";
    setStatus("wallet-dot", false);
  }
}

init();
