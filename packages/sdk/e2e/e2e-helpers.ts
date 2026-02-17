/**
 * Shared e2e test helpers.
 *
 * Extracted from proving.test.ts and mode-switching.test.ts to avoid
 * duplicating the Schnorr account deployment logic.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["tee-rex", "sdk", "e2e", "helpers"]);

/** Deploy a new Schnorr account using the current prover mode with Sponsored FPC. */
export async function deploySchnorrAccount(
  wallet: EmbeddedWallet,
  feePaymentMethod: SponsoredFeePaymentMethod,
  label?: string,
) {
  const tag = label ? ` (${label})` : "";
  const secret = Fr.random();
  const salt = Fr.random();
  const accountManager = await wallet.createSchnorrAccount(secret, salt);

  logger.debug(`Deploying account${tag}`, { address: accountManager.address.toString() });

  const startTime = Date.now();
  const deployMethod = await accountManager.getDeployMethod();
  const deployedContract = await deployMethod.send({
    from: AztecAddress.ZERO,
    skipClassPublication: true,
    fee: { paymentMethod: feePaymentMethod },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info(`Account deployed${tag}`, {
    contract: deployedContract.address?.toString(),
    durationSec: elapsed,
  });

  return deployedContract;
}
