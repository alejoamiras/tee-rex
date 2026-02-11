import "./style.css";
import {
  AZTEC_DISPLAY_URL,
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  deployTestAccount,
  initializeWallet,
  PROVER_DISPLAY_URL,
  runTokenFlow,
  setUiMode,
  state,
  type UiMode,
} from "./aztec";
import { $, appendLog, formatDuration, setStatus, startClock } from "./ui";

let deploying = false;
const runCount: Record<string, number> = { local: 0, remote: 0, tee: 0 };

// ── Clock ──
startClock();

// ── Service checks ──
async function checkServices(): Promise<{ aztec: boolean; teerex: boolean }> {
  const [aztec, teerex] = await Promise.all([checkAztecNode(), checkTeeRexServer()]);
  setStatus("aztec-status", aztec);
  setStatus("teerex-status", teerex);
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

  $("tee-config").classList.toggle("hidden", mode !== "tee");
}

$("mode-local").addEventListener("click", () => {
  if (deploying) return;
  setUiMode("local");
  updateModeUI("local");
  appendLog("Switched to local proving mode");
});

$("mode-remote").addEventListener("click", () => {
  if (deploying) return;
  setUiMode("remote");
  updateModeUI("remote");
  appendLog("Switched to remote proving mode");
});

$("mode-tee").addEventListener("click", () => {
  if (deploying) return;
  updateModeUI("tee");
  const url = ($("tee-url") as HTMLInputElement).value.trim();
  if (url) {
    setUiMode("tee", url);
    appendLog(`Switched to TEE proving mode → ${url}`);
    runTeeCheck(url);
  } else {
    appendLog("Enter TEE server URL, then click Check", "warn");
  }
});

async function runTeeCheck(url: string): Promise<void> {
  const dot = $("tee-attestation-dot");
  const label = $("tee-attestation-label");
  dot.className = "status-dot status-unknown";
  label.textContent = "attestation: checking...";
  appendLog(`Checking TEE attestation at ${url}...`);

  const result = await checkTeeAttestation(url);
  if (result.reachable) {
    dot.className = `status-dot ${result.mode === "nitro" ? "status-online" : "status-offline"}`;
    label.textContent = `attestation: ${result.mode ?? "unknown"}`;
    setUiMode("tee", url);
    appendLog(
      `TEE server reachable — mode: ${result.mode}`,
      result.mode === "nitro" ? "success" : "warn",
    );
  } else {
    dot.className = "status-dot status-offline";
    label.textContent = "attestation: unreachable";
    appendLog(`TEE server unreachable at ${url}`, "error");
  }
}

$("tee-check-btn").addEventListener("click", () => {
  const url = ($("tee-url") as HTMLInputElement).value.trim();
  if (!url) {
    appendLog("Enter a TEE server URL first", "warn");
    return;
  }
  runTeeCheck(url);
});

$("tee-url").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") {
    const url = ($("tee-url") as HTMLInputElement).value.trim();
    if (url) runTeeCheck(url);
  }
});

// ── Shared helpers ──
function setActionButtonsDisabled(disabled: boolean): void {
  ($("deploy-btn") as HTMLButtonElement).disabled = disabled;
  ($("token-flow-btn") as HTMLButtonElement).disabled = disabled;
}

function showResult(mode: UiMode, durationMs: number, tag: string): void {
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
}

// ── Deploy ──
$("deploy-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $("deploy-btn") as HTMLButtonElement;
  btn.textContent = "Proving...";

  $("progress").classList.remove("hidden");
  $("elapsed-time").textContent = "0.0s";

  try {
    const result = await deployTestAccount(appendLog, (elapsedMs) => {
      $("elapsed-time").textContent = formatDuration(elapsedMs);
      $("progress-text").textContent = `proving [${state.uiMode}]...`;
    });

    runCount[result.mode]++;
    const isCold = runCount[result.mode] === 1;
    showResult(result.mode, result.durationMs, isCold ? "cold" : "warm");
  } catch (err) {
    appendLog(`Deploy failed: ${err}`, "error");
  } finally {
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

  const btn = $("token-flow-btn") as HTMLButtonElement;
  btn.textContent = "Running...";

  $("progress").classList.remove("hidden");
  $("elapsed-time").textContent = "0.0s";

  try {
    const result = await runTokenFlow(
      appendLog,
      (elapsedMs) => {
        $("elapsed-time").textContent = formatDuration(elapsedMs);
      },
      (stepName) => {
        $("progress-text").textContent = `${stepName}...`;
      },
    );

    appendLog("--- step breakdown ---");
    for (const step of result.steps) {
      appendLog(`  ${step.step}: ${formatDuration(step.durationMs)}`);
    }
    appendLog(`  total: ${formatDuration(result.totalDurationMs)}`);

    showResult(result.mode, result.totalDurationMs, "token flow");
  } catch (err) {
    appendLog(`Token flow failed: ${err}`, "error");
  } finally {
    deploying = false;
    setActionButtonsDisabled(false);
    btn.textContent = "Run Token Flow";
    $("progress").classList.add("hidden");
  }
});

// ── Init ──
async function init(): Promise<void> {
  $("aztec-url").textContent = AZTEC_DISPLAY_URL;
  $("teerex-url").textContent = PROVER_DISPLAY_URL;

  appendLog("Checking services...");
  const { aztec, teerex } = await checkServices();

  if (!aztec) {
    appendLog(`Aztec node not reachable at ${AZTEC_DISPLAY_URL}`, "error");
    appendLog("Start the Aztec node before using the demo", "warn");
    $("wallet-state").textContent = "aztec unavailable";
    setStatus("wallet-dot", false);
    return;
  }

  if (!teerex) {
    appendLog("TEE-Rex server not reachable — remote proving unavailable", "warn");
    setUiMode("local");
    updateModeUI("local");
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
    if (state.isLiveNetwork) {
      networkLabel.textContent = "live";
      networkLabel.className = "text-amber-500/80 text-[10px] uppercase tracking-wider ml-2";
      appendLog("Ready — deploy a test account to get started (live network)", "success");
    } else {
      networkLabel.textContent = "local network";
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
