import "./style.css";
import { AsciiController } from "./ascii-animation";
import {
  AZTEC_DISPLAY_URL,
  checkAztecNode,
  checkTeeAttestation,
  checkTeeRexServer,
  deployTestAccount,
  ENV_NAME,
  initializeFPC,
  initializeNode,
  initializeWallet,
  OTHER_ENV_NAME,
  OTHER_ENV_URL,
  PROVER_CONFIGURED,
  PROVER_DISPLAY_URL,
  revertToEmbedded,
  runTokenFlow,
  setExternalWallet,
  setUiMode,
  state,
  TEE_CONFIGURED,
  TEE_DISPLAY_URL,
  type UiMode,
} from "./aztec";
import {
  hideExternalUI,
  initExternalWalletUI,
  populateExternalWalletUI,
  showExternalUI,
} from "./external-wallet-ui";
import { showResult, stepToPhase } from "./results";
import { $, $btn, appendLog, formatDuration, setStatus, startClock } from "./ui";
import { disconnectWallet, onDisconnect, type WalletProvider } from "./wallet-connect";
import {
  hideWalletSelection,
  initWalletSelection,
  wireWalletSelectionListeners,
} from "./wallet-selection";

let deploying = false;
let disconnectUnsub: (() => void) | null = null;
let currentExternalProvider: WalletProvider | null = null;

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

// ── Embedded UI: Deploy ──
$("deploy-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("deploy-btn");
  btn.textContent = "Proving...";

  $("progress").classList.remove("hidden");

  const ascii = new AsciiController($("ascii-art"));
  ascii.start(state.uiMode);

  try {
    const result = await deployTestAccount(
      appendLog,
      () => {},
      (stepName) => {
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

    showResult("", result.mode, result.totalDurationMs, undefined, result.steps);
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

// ── Embedded UI: Token Flow ──
$("token-flow-btn").addEventListener("click", async () => {
  if (deploying) return;
  deploying = true;
  setActionButtonsDisabled(true);

  const btn = $btn("token-flow-btn");
  btn.textContent = "Running...";

  $("progress").classList.remove("hidden");

  const ascii = new AsciiController($("ascii-art"));
  ascii.start(state.uiMode);

  try {
    const result = await runTokenFlow(
      appendLog,
      () => {},
      (stepName) => {
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

    showResult("", result.mode, result.totalDurationMs, "token flow", result.steps);
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

// ── Embedded → External switch ──
$("switch-to-external-btn").addEventListener("click", () => {
  if (deploying) return;
  $("embedded-ui").classList.add("hidden");
  goToWalletSelection();
});

// ── UI transitions ──

function showEmbeddedUI(): void {
  $("embedded-ui").classList.remove("hidden");
  hideExternalUI();
  hideWalletSelection();
}

async function handleDisconnect(): Promise<void> {
  if (disconnectUnsub) {
    disconnectUnsub();
    disconnectUnsub = null;
  }
  if (currentExternalProvider) {
    try {
      await disconnectWallet(currentExternalProvider);
    } catch {
      // Already disconnected
    }
    currentExternalProvider = null;
  }
  revertToEmbedded();
  hideExternalUI();
  appendLog("External wallet disconnected — returning to wallet selection");
  goToWalletSelection();
}

/** Cached chain info from initial service check. */
let cachedChainInfo: { chainId: any; version: any } | null = null;
let nodeReady = false;

function goToWalletSelection(): void {
  initWalletSelection({
    nodeReady,
    chainInfo: cachedChainInfo,
    callbacks: {
      onChooseEmbedded: () => {
        hideWalletSelection();

        if (state.embeddedWallet) {
          // Re-use existing embedded wallet
          revertToEmbedded();
          showEmbeddedUI();
          setActionButtonsDisabled(false);
          appendLog("Switched back to embedded wallet");
        } else {
          // First time — initialize embedded wallet
          showEmbeddedUI();
          initEmbeddedWallet();
        }
      },
      onChooseExternal: async (wallet, provider, accounts) => {
        hideWalletSelection();

        // Ensure node is connected (may already be done)
        if (!state.node) {
          try {
            appendLog("Connecting to Aztec node...");
            await initializeNode(appendLog);
          } catch (err) {
            appendLog(`Node connection failed: ${err}`, "error");
            goToWalletSelection();
            return;
          }
        }

        setExternalWallet(wallet, provider, accounts);
        currentExternalProvider = provider;

        // Register FPC on external wallet
        try {
          await initializeFPC(wallet, appendLog);
        } catch (err) {
          appendLog(`FPC setup failed: ${err}`, "error");
        }

        // Register disconnect handler
        disconnectUnsub = onDisconnect(provider, () => {
          appendLog("External wallet disconnected unexpectedly", "warn");
          handleDisconnect();
        });

        populateExternalWalletUI(
          provider.name,
          provider.icon,
          accounts.map((a) => a.toString()),
        );
        showExternalUI();
        hideWalletSelection();

        appendLog(`Using external wallet: ${provider.name}`, "success");
      },
    },
    log: appendLog,
  });
}

async function initEmbeddedWallet(): Promise<void> {
  appendLog("Initializing wallet...");
  $("wallet-state").textContent = "initializing...";
  setStatus("wallet-dot", null);

  const ok = await initializeWallet(appendLog);
  if (ok) {
    $("wallet-state").textContent = "ready";
    $("wallet-state").className = "text-emerald-500/80 ml-auto font-light";
    setStatus("wallet-dot", true);
    setActionButtonsDisabled(false);
    $("switch-to-external-wrapper").classList.remove("hidden");

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

// ── Init ──
async function init(): Promise<void> {
  $("aztec-url").textContent = AZTEC_DISPLAY_URL;
  if (PROVER_CONFIGURED) {
    $("teerex-url").textContent = PROVER_DISPLAY_URL;
  }

  // Wire up wallet selection listeners once
  wireWalletSelectionListeners();

  // Wire up external wallet UI listeners once
  initExternalWalletUI({
    log: appendLog,
    onSwitchWallet: handleDisconnect,
  });

  appendLog("Checking services...");
  const { aztec, teerex } = await checkServices();

  if (PROVER_CONFIGURED && !teerex) {
    appendLog("TEE-Rex server not reachable — remote proving unavailable", "warn");
  }

  // Auto-configure TEE
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

  nodeReady = aztec;

  // Cache chain info for wallet discovery
  if (aztec && state.node === null) {
    // Node is available but not yet connected — we'll get chain info via a lightweight check
    try {
      const node = (await import("@aztec/aztec.js/node")).createAztecNodeClient(
        process.env.AZTEC_NODE_URL || "/aztec",
      );
      const [chainId, version] = await Promise.all([node.getChainId(), node.getVersion()]);
      const { Fr } = await import("@aztec/aztec.js/fields");
      cachedChainInfo = { chainId: new Fr(chainId), version: new Fr(version) };
    } catch {
      // Node reachable for /status but RPC failed — ok, discovery will work without chain info
    }
  }

  // E2E bypass: ?wallet=embedded skips wallet selection
  const walletParam = new URLSearchParams(window.location.search).get("wallet");
  if (walletParam === "embedded") {
    showEmbeddedUI();
    if (aztec) {
      await initEmbeddedWallet();
    } else {
      appendLog(`Aztec node not reachable at ${AZTEC_DISPLAY_URL}`, "error");
      appendLog("Start the Aztec node before using the demo", "warn");
      $("wallet-state").textContent = "aztec unavailable";
      setStatus("wallet-dot", false);
    }
    return;
  }

  // Normal flow: show wallet selection
  goToWalletSelection();
}

init();
