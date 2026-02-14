import "./style.css";
import {
  AZTEC_DISPLAY_URL,
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  deployTestAccount,
  initializeWallet,
  PROVER_CONFIGURED,
  PROVER_DISPLAY_URL,
  runTokenFlow,
  setUiMode,
  state,
  TEE_CONFIGURED,
  TEE_DISPLAY_URL,
  type UiMode,
} from "./aztec";
import { $, appendLog, formatDuration, setStatus, startClock } from "./ui";

let deploying = false;
const runCount: Record<string, number> = { local: 0, remote: 0, tee: 0 };

// ── Clock ──
startClock();

// ── Service checks ──
async function checkServices(): Promise<{ aztec: boolean; teerex: boolean }> {
  const aztec = await checkAztecNode();
  setStatus("aztec-status", aztec);

  let teerex = false;
  if (PROVER_CONFIGURED) {
    ($("mode-remote") as HTMLButtonElement).disabled = false;
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
  if (deploying || ($("mode-remote") as HTMLButtonElement).disabled) return;
  setUiMode("remote");
  updateModeUI("remote");
  appendLog("Switched to remote proving mode");
});

$("mode-tee").addEventListener("click", () => {
  if (deploying || ($("mode-tee") as HTMLButtonElement).disabled) return;
  setUiMode("tee");
  updateModeUI("tee");
  appendLog("Switched to TEE proving mode");
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
  if (PROVER_CONFIGURED) {
    $("teerex-url").textContent = PROVER_DISPLAY_URL;
  }

  appendLog("Checking services...");
  const { aztec, teerex } = await checkServices();

  if (!aztec) {
    appendLog(`Aztec node not reachable at ${AZTEC_DISPLAY_URL}`, "error");
    appendLog("Start the Aztec node before using the demo", "warn");
    $("wallet-state").textContent = "aztec unavailable";
    setStatus("wallet-dot", false);
    return;
  }

  if (PROVER_CONFIGURED && !teerex) {
    appendLog("TEE-Rex server not reachable — remote proving unavailable", "warn");
  }

  // Auto-configure TEE when env var is set (display URL + check attestation)
  if (TEE_CONFIGURED) {
    $("tee-url").textContent = TEE_DISPLAY_URL;
    appendLog(`TEE_URL configured (${TEE_DISPLAY_URL}) — checking attestation...`);
    const attestation = await checkTeeAttestation("/tee");
    if (attestation.reachable) {
      setStatus("tee-status", attestation.mode === "nitro");
      $("tee-attestation-label").textContent =
        attestation.mode === "nitro" ? "attested" : `attestation: ${attestation.mode ?? "unknown"}`;
      if (attestation.mode === "nitro") {
        ($("mode-tee") as HTMLButtonElement).disabled = false;
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
