import "./style.css";
import {
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  deployTestAccount,
  initializeWallet,
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
      $("progress-text").textContent = `proving [${state.uiMode}]...`;
    });

    // Show results
    runCount[result.mode]++;
    const isCold = runCount[result.mode] === 1;
    const suffix = result.mode; // "local" | "remote" | "tee"

    $("results").classList.remove("hidden");
    const timeEl = $(`time-${suffix}`);
    timeEl.textContent = formatDuration(result.durationMs);
    timeEl.className = "text-3xl font-bold tabular-nums text-emerald-400";

    const tagEl = $(`tag-${suffix}`);
    tagEl.textContent = isCold ? "cold" : "warm";
    tagEl.className = `mt-1.5 text-[10px] uppercase tracking-widest ${isCold ? "text-amber-500/70" : "text-cyan-500/70"}`;

    const card = $(`result-${suffix}`);
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
