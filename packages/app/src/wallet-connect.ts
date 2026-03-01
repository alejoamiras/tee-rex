import type { ChainInfo } from "@aztec/aztec.js/account";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import {
  type DiscoverySession,
  type PendingConnection,
  WalletManager,
  type WalletProvider,
} from "@aztec/wallet-sdk/manager";

const APP_ID = "tee-rex";

export type WalletConnectionPhase =
  | "idle"
  | "discovering"
  | "verifying"
  | "connecting"
  | "connected";

export interface DiscoveryHandle {
  session: DiscoverySession;
  cancel: () => void;
}

/**
 * Start wallet discovery via the Wallet SDK. Returns a session that
 * streams discovered wallets via the `onWalletDiscovered` callback.
 */
export function discoverWallets(
  chainInfo: ChainInfo,
  onWalletDiscovered: (provider: WalletProvider) => void,
  timeout = 10_000,
): DiscoveryHandle {
  const manager = WalletManager.configure({ extensions: { enabled: true } });
  const session = manager.getAvailableWallets({
    chainInfo,
    appId: APP_ID,
    timeout,
    onWalletDiscovered,
  });
  return { session, cancel: () => session.cancel() };
}

/**
 * Initiate secure channel with a wallet provider.
 * Returns the pending connection and the emoji string for verification.
 */
export async function initiateConnection(
  provider: WalletProvider,
): Promise<{ pending: PendingConnection; emojis: string }> {
  const pending = await provider.establishSecureChannel(APP_ID);
  const emojis = hashToEmoji(pending.verificationHash);
  return { pending, emojis };
}

/**
 * Confirm the emoji verification — returns the connected Wallet.
 */
export async function confirmConnection(pending: PendingConnection): Promise<Wallet> {
  return pending.confirm();
}

/**
 * Cancel a pending connection (emojis didn't match).
 */
export function cancelConnection(pending: PendingConnection): void {
  pending.cancel();
}

/**
 * Disconnect from a wallet provider.
 */
export async function disconnectWallet(provider: WalletProvider): Promise<void> {
  await provider.disconnect();
}

/**
 * Register a disconnect handler on the provider.
 * Returns an unsubscribe function.
 */
export function onDisconnect(provider: WalletProvider, callback: () => void): () => void {
  return provider.onDisconnect(callback);
}

export type { WalletProvider, PendingConnection };
