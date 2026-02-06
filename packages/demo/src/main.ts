import "./style.css";
import { ProvingMode } from "@nemi-fi/tee-rex";
import {
  checkAztecNode,
  checkTeeRexServer,
  deployTestAccount,
  initializeWallet,
  setProvingMode,
  state,
} from "./aztec";
import { $, appendLog, formatDuration, setStatus, startClock } from "./ui";

let deploying = false;

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
function updateModeUI(mode: string): void {
  const localBtn = $("mode-local");
  const remoteBtn = $("mode-remote");
  const inactiveClass =
    "mode-btn flex-1 py-2.5 px-4 text-xs font-medium uppercase tracking-wider border transition-all duration-150 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400";
  const activeClass =
    "mode-btn flex-1 py-2.5 px-4 text-xs font-medium uppercase tracking-wider border transition-all duration-150 mode-active";

  if (mode === "local") {
    localBtn.className = activeClass;
    remoteBtn.className = inactiveClass;
  } else {
    localBtn.className = inactiveClass;
    remoteBtn.className = activeClass;
  }
}

$("mode-local").addEventListener("click", () => {
  if (deploying) return;
  setProvingMode(ProvingMode.local);
  updateModeUI("local");
  appendLog("Switched to local proving mode");
});

$("mode-remote").addEventListener("click", () => {
  if (deploying) return;
  setProvingMode(ProvingMode.remote);
  updateModeUI("remote");
  appendLog("Switched to remote proving mode");
});

// ── Deploy ──
$("deploy-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;

  const btn = $("deploy-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Proving...";

  $("progress").classList.remove("hidden");
  $("elapsed-time").textContent = "0.0s";

  try {
    const result = await deployTestAccount(appendLog, (elapsedMs) => {
      $("elapsed-time").textContent = formatDuration(elapsedMs);
      $("progress-text").textContent = `proving [${state.provingMode}]...`;
    });

    // Show results
    $("results").classList.remove("hidden");
    const timeEl = $(result.mode === "local" ? "time-local" : "time-remote");
    timeEl.textContent = formatDuration(result.durationMs);
    timeEl.className = "text-3xl font-bold tabular-nums text-emerald-400";

    const card = $(result.mode === "local" ? "result-local" : "result-remote");
    card.classList.add("result-filled");
  } catch (err) {
    appendLog(`Deploy failed: ${err}`, "error");
  } finally {
    deploying = false;
    btn.disabled = false;
    btn.textContent = "Deploy Test Account";
    $("progress").classList.add("hidden");
  }
});

// ── Init ──
async function init(): Promise<void> {
  appendLog("Checking services...");
  const { aztec, teerex } = await checkServices();

  if (!aztec) {
    appendLog("Aztec node not reachable at localhost:8080", "error");
  }
  if (!teerex) {
    appendLog("TEE-Rex server not reachable at localhost:4000", "error");
  }
  if (!aztec || !teerex) {
    appendLog("Start services before using the demo", "warn");
    $("wallet-state").textContent = "services unavailable";
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
    ($("deploy-btn") as HTMLButtonElement).disabled = false;
    appendLog("Ready — deploy a test account to begin", "success");
  } else {
    $("wallet-state").textContent = "failed";
    $("wallet-state").className = "text-red-400/80 ml-auto font-light";
    setStatus("wallet-dot", false);
  }
}

init();
