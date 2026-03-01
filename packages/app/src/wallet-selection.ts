import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import type { LogFn } from "./aztec";
import { $, appendLog } from "./ui";
import {
  cancelConnection,
  confirmConnection,
  discoverWallets,
  initiateConnection,
  type PendingConnection,
  type WalletProvider,
} from "./wallet-connect";

let discoveryHandle: ReturnType<typeof discoverWallets> | null = null;
let pendingConn: PendingConnection | null = null;
let selectedProvider: WalletProvider | null = null;
let cachedChainInfo: { chainId: any; version: any } | null = null;

/** Extract a display hex string from a wallet-sdk account entry. */
function accountToHex(account: any): string {
  const raw = account?.item ?? account?.address ?? account;
  if (typeof raw === "string") return raw;
  if (typeof raw?.toHexString === "function") return raw.toHexString();
  return String(raw);
}

export interface WalletSelectionCallbacks {
  onChooseEmbedded: () => void;
  onChooseExternal: (
    wallet: Wallet,
    provider: WalletProvider,
    accounts: AztecAddress[],
    aliases: (string | undefined)[],
  ) => void;
}

let callbacks: WalletSelectionCallbacks | null = null;

export function showWalletSelection(): void {
  $("wallet-selection").classList.remove("hidden");
  $("embedded-ui").classList.add("hidden");
  $("external-ui").classList.add("hidden");
}

export function hideWalletSelection(): void {
  $("wallet-selection").classList.add("hidden");
}

function resetEmojiSection(): void {
  $("ext-emoji-section").classList.add("hidden");
  $("ext-emoji-grid").replaceChildren();
  pendingConn = null;
  selectedProvider = null;
}

/** Reset to the initial two-button view (hide discovery section). */
function resetToChoiceButtons(): void {
  $("ext-discovery-section").classList.add("hidden");
  $("choose-external-btn").classList.remove("hidden");
  resetEmojiSection();
  if (discoveryHandle) {
    discoveryHandle.cancel();
    discoveryHandle = null;
  }
}

export function initWalletSelection(opts: {
  nodeReady: boolean;
  chainInfo: { chainId: any; version: any } | null;
  callbacks: WalletSelectionCallbacks;
  log: LogFn;
}): void {
  callbacks = opts.callbacks;
  cachedChainInfo = opts.chainInfo;

  // Enable embedded button if node is ready
  const embeddedBtn = $("choose-embedded-btn") as HTMLButtonElement;
  embeddedBtn.disabled = !opts.nodeReady;

  // Reset to two-button view (discovery is deferred until user clicks)
  resetToChoiceButtons();

  showWalletSelection();
}

/** Start wallet discovery — called when user clicks "Connect external wallet". */
function startDiscovery(): void {
  // Hide the choice button, show discovery section
  $("choose-external-btn").classList.add("hidden");
  const discoverySection = $("ext-discovery-section");
  discoverySection.classList.remove("hidden");

  const walletList = $("ext-wallet-list");
  walletList.replaceChildren();
  walletList.classList.remove("hidden");
  const searchStatus = $("ext-wallet-search-status");
  searchStatus.textContent = "Searching for wallets...";
  searchStatus.classList.remove("hidden");
  $("ext-cancel-discovery-btn").classList.remove("hidden");
  resetEmojiSection();

  if (cachedChainInfo) {
    let found = 0;
    discoveryHandle = discoverWallets(cachedChainInfo, (provider) => {
      found++;
      searchStatus.classList.add("hidden");
      const btn = document.createElement("button");
      btn.className =
        "wallet-choice-card w-full flex items-center gap-2 px-4 py-2.5 text-xs border border-gray-800 transition-all duration-150 text-left";
      if (provider.icon) {
        const img = document.createElement("img");
        img.src = provider.icon;
        img.alt = "";
        img.className = "w-4 h-4";
        btn.appendChild(img);
      }
      const nameSpan = document.createElement("span");
      nameSpan.className = "text-gray-300 font-medium";
      nameSpan.textContent = provider.name;
      btn.appendChild(nameSpan);

      btn.addEventListener("click", () => handleWalletClick(provider));
      walletList.appendChild(btn);
    });

    discoveryHandle.session.done.then(() => {
      if (found === 0) {
        searchStatus.textContent = "No wallets found. Install an Aztec wallet extension.";
        searchStatus.classList.remove("hidden");
      }
    });
  } else {
    searchStatus.textContent = "Aztec node unavailable — external wallets may still work";
  }
}

async function handleWalletClick(provider: WalletProvider): Promise<void> {
  if (discoveryHandle) {
    discoveryHandle.cancel();
    discoveryHandle = null;
  }

  // Hide wallet list, show emoji section
  $("ext-wallet-list").classList.add("hidden");
  $("ext-wallet-search-status").classList.add("hidden");
  $("ext-cancel-discovery-btn").classList.add("hidden");
  $("ext-emoji-section").classList.remove("hidden");
  appendLog(`Connecting to ${provider.name}...`);

  try {
    const { pending, emojis } = await initiateConnection(provider);
    pendingConn = pending;
    selectedProvider = provider;

    const grid = $("ext-emoji-grid");
    grid.replaceChildren();
    for (const emoji of emojis) {
      const cell = document.createElement("span");
      cell.className = "emoji-cell";
      cell.textContent = emoji;
      grid.appendChild(cell);
    }
  } catch (err) {
    appendLog(`Connection failed: ${err}`, "error");
    resetToWalletList();
  }
}

function resetToWalletList(): void {
  resetEmojiSection();
  $("ext-wallet-list").classList.remove("hidden");
  $("ext-wallet-search-status").classList.remove("hidden");
  $("ext-cancel-discovery-btn").classList.remove("hidden");
}

// Wire up static event listeners
function wireEmojiConfirm(): void {
  $("ext-emoji-confirm-btn").addEventListener("click", async () => {
    if (!pendingConn || !selectedProvider) return;
    const providerName = selectedProvider.name;

    try {
      appendLog("Confirming connection...");
      const wallet = await confirmConnection(pendingConn);

      // Get accounts — try requestCapabilities first, fall back to getAccounts
      let accounts: any[] = [];
      try {
        const capabilities = await wallet.requestCapabilities({
          version: "1.0",
          metadata: {
            name: "TEE-Rex",
            version: "1.0.0",
            description: "Compare local, remote & TEE zero-knowledge proving",
            url: window.location.origin,
          },
          capabilities: [
            { type: "accounts", canGet: true },
            {
              type: "simulation",
              utilities: { scope: [{ contract: "*", function: "*" }] },
              transactions: { scope: [{ contract: "*", function: "*" }] },
            },
            {
              type: "transaction",
              scope: [{ contract: "*", function: "*" }],
            },
          ],
        });
        const accountsCap = capabilities.granted.find((c: any) => c.type === "accounts") as
          | { type: "accounts"; accounts: any[] }
          | undefined;
        accounts = accountsCap?.accounts ?? [];
      } catch (capErr) {
        appendLog(`requestCapabilities failed, trying getAccounts: ${capErr}`, "warn");
      }

      if (accounts.length === 0) {
        try {
          accounts = await wallet.getAccounts();
        } catch {
          // ignore
        }
      }

      if (accounts.length === 0) {
        appendLog("No accounts granted by wallet", "error");
        resetToWalletList();
        return;
      }

      const addresses = accounts.map((acct: any) => {
        const raw = acct?.item ?? acct?.address ?? acct;
        return raw instanceof AztecAddress ? raw : AztecAddress.fromString(accountToHex(acct));
      });
      const aliases = accounts.map((acct: any) => acct?.alias as string | undefined);

      appendLog(`Connected to ${providerName} — ${accounts.length} account(s)`, "success");
      callbacks?.onChooseExternal(wallet, selectedProvider, addresses, aliases);
    } catch (err) {
      appendLog(`Connection confirmation failed: ${err}`, "error");
      resetToWalletList();
    }
  });
}

function wireEmojiReject(): void {
  $("ext-emoji-reject-btn").addEventListener("click", () => {
    if (pendingConn) {
      cancelConnection(pendingConn);
    }
    appendLog("Emoji verification rejected — connection cancelled", "warn");
    resetToWalletList();
  });
}

function wireEmbeddedBtn(): void {
  $("choose-embedded-btn").addEventListener("click", () => {
    callbacks?.onChooseEmbedded();
  });
}

function wireExternalBtn(): void {
  $("choose-external-btn").addEventListener("click", () => {
    startDiscovery();
  });
}

function wireCancelDiscovery(): void {
  $("ext-cancel-discovery-btn").addEventListener("click", () => {
    appendLog("Wallet discovery cancelled");
    resetToChoiceButtons();
  });
}

// Initialize event listeners once
let listenersWired = false;
export function wireWalletSelectionListeners(): void {
  if (listenersWired) return;
  listenersWired = true;
  wireEmbeddedBtn();
  wireExternalBtn();
  wireCancelDiscovery();
  wireEmojiConfirm();
  wireEmojiReject();
}
