import { AsciiController } from "./ascii-animation";
import { deployToken, ENV_NAME, runTokenFlow, setSelectedAccount } from "./aztec";
import { showResult, stepToPhase } from "./results";
import { $, $btn, type appendLog, formatDuration } from "./ui";

let deploying = false;
const runCount = { wallet: 0 };

export interface AccountEntry {
  address: string;
  alias?: string;
}

export function initExternalWalletUI(opts: {
  log: typeof appendLog;
  onSwitchWallet: () => void;
}): void {
  // Disconnect / switch wallet button
  $("ext-disconnect-btn").addEventListener("click", () => {
    opts.onSwitchWallet();
  });

  // Account selector
  $("ext-account-selector").addEventListener("change", () => {
    const select = $("ext-account-selector") as HTMLSelectElement;
    setSelectedAccount(select.selectedIndex);
    opts.log(`Switched to account ${select.selectedIndex + 1}: ${select.value.slice(0, 20)}...`);
  });

  // Deploy token
  $("ext-deploy-token-btn").addEventListener("click", async () => {
    if (deploying) return;
    deploying = true;
    setExtActionButtonsDisabled(true);

    const btn = $btn("ext-deploy-token-btn");
    btn.textContent = "Proving...";

    $("ext-progress").classList.remove("hidden");
    const ascii = new AsciiController($("ext-ascii-art"));
    ascii.start("local"); // External wallets handle proving — use local animation as placeholder

    try {
      const result = await deployToken(
        opts.log,
        () => {},
        (stepName) => {
          const phase = stepToPhase(stepName);
          if (phase) ascii.pushPhase(phase);
        },
        (phase) => ascii.pushPhase(phase),
      );

      opts.log("--- step breakdown ---");
      for (const step of result.steps) {
        opts.log(`  ${step.step}: ${formatDuration(step.durationMs)}`);
      }
      opts.log(`  total: ${formatDuration(result.totalDurationMs)}`);

      runCount.wallet++;
      const isCold = runCount.wallet === 1;
      showResult("ext-", "wallet", result.totalDurationMs, isCold ? "cold" : "warm", result.steps);
    } catch (err) {
      opts.log(`Deploy failed: ${err}`, "error");
    } finally {
      ascii.stop();
      deploying = false;
      setExtActionButtonsDisabled(false);
      btn.textContent = "Deploy Token";
      $("ext-progress").classList.add("hidden");
    }
  });

  // Run token flow
  $("ext-token-flow-btn").addEventListener("click", async () => {
    if (deploying) return;
    deploying = true;
    setExtActionButtonsDisabled(true);

    const btn = $btn("ext-token-flow-btn");
    btn.textContent = "Running...";

    $("ext-progress").classList.remove("hidden");
    const ascii = new AsciiController($("ext-ascii-art"));
    ascii.start("local");

    try {
      const result = await runTokenFlow(
        opts.log,
        () => {},
        (stepName) => {
          const phase = stepToPhase(stepName);
          if (phase) ascii.pushPhase(phase);
        },
        (phase) => ascii.pushPhase(phase),
      );

      opts.log("--- step breakdown ---");
      for (const step of result.steps) {
        opts.log(`  ${step.step}: ${formatDuration(step.durationMs)}`);
      }
      opts.log(`  total: ${formatDuration(result.totalDurationMs)}`);

      showResult("ext-", "wallet", result.totalDurationMs, "token flow", result.steps);
    } catch (err) {
      opts.log(`Token flow failed: ${err}`, "error");
    } finally {
      ascii.stop();
      deploying = false;
      setExtActionButtonsDisabled(false);
      btn.textContent = "Run Token Flow";
      $("ext-progress").classList.add("hidden");
    }
  });
}

function setExtActionButtonsDisabled(disabled: boolean): void {
  $btn("ext-deploy-token-btn").disabled = disabled;
  $btn("ext-token-flow-btn").disabled = disabled;
}

/** Short display label for an account — alias if available, otherwise truncated address. */
function accountLabel(entry: AccountEntry): string {
  return entry.alias || `${entry.address.slice(0, 20)}...`;
}

/** Populate the external wallet info bar. */
export function populateExternalWalletUI(
  walletName: string,
  icon: string | undefined,
  accounts: AccountEntry[],
): void {
  // Network label
  const networkLabel = ENV_NAME || "local sandbox";
  $("ext-network-label").textContent = networkLabel;
  $("ext-network-dot").className = "status-dot status-online";

  // Wallet name + icon
  $("ext-wallet-name").textContent = walletName;
  const iconEl = $("ext-wallet-icon") as HTMLImageElement;
  const placeholder = $("ext-wallet-icon-placeholder");
  if (icon) {
    iconEl.src = icon;
    iconEl.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    iconEl.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }

  // Account selector or static address
  const selector = $("ext-account-selector") as HTMLSelectElement;
  const addressSpan = $("ext-wallet-address");

  if (accounts.length > 1) {
    selector.replaceChildren();
    for (const acct of accounts) {
      const opt = document.createElement("option");
      opt.value = acct.address;
      opt.textContent = accountLabel(acct);
      selector.appendChild(opt);
    }
    selector.classList.remove("hidden");
    addressSpan.classList.add("hidden");
  } else {
    addressSpan.textContent = accountLabel(accounts[0]);
    addressSpan.classList.remove("hidden");
    selector.classList.add("hidden");
  }

  // Enable action buttons
  setExtActionButtonsDisabled(false);
}

export function showExternalUI(): void {
  $("external-ui").classList.remove("hidden");
}

export function hideExternalUI(): void {
  $("external-ui").classList.add("hidden");
}
