"use client";

/**
 * Withdraw signature client for the TapTrade arena.
 *
 * The user's free balance lives off-chain on the engine. To pull ETH
 * out of `TradingVault` the user has to first call this endpoint —
 * the engine validates the request against the off-chain ledger
 * (free balance + on-chain vault liquidity), reserves the amount,
 * and returns an EIP-191 signature that the user then submits to
 * `TradingVault.withdraw(amount, nonce, sig)` on-chain.
 *
 * Signature digest committed by the engine:
 *   keccak256(abi.encode(chainId, vault, user, amount, nonce))
 *   .toEthSignedMessageHash()
 *
 * The engine binds the signer EOA in `engine/.env`. The same EOA's
 * address is the `engineSigner` baked into the deployed vault.
 */

import { authedFetch } from "@/lib/api/taptradeAuth";

export interface WithdrawAuthorization {
  authorizationId: string;
  userId: string;
  wallet: `0x${string}`;
  amountWei: string;
  nonce: bigint;
  signature: `0x${string}`;
  signerAddress: `0x${string}`;
  chainId: number;
  vaultAddress: `0x${string}`;
}

interface SignWithdrawApiResponse {
  authorization_id: string;
  user_id: string;
  wallet: string;
  amount_wei: string;
  nonce: number;
  signature: string;
  signer_address: string;
  chain_id: number;
  vault_address: string;
}

/**
 * Asks the engine to authorize a withdrawal of `amountWei` for the
 * authenticated user. Returns the signed authorization the wallet
 * then submits on-chain.
 *
 * Throws on insufficient balance, insufficient on-chain liquidity,
 * or any other engine-side rejection — caller surfaces to UI.
 */
export async function signWithdraw(
  amountWei: string
): Promise<WithdrawAuthorization> {
  const res = await authedFetch<SignWithdrawApiResponse>(
    "/trade/withdraw/sign",
    {
      method: "POST",
      body: JSON.stringify({ amount_wei: amountWei }),
    }
  );

  return {
    authorizationId: res.authorization_id,
    userId: res.user_id,
    wallet: res.wallet as `0x${string}`,
    amountWei: res.amount_wei,
    nonce: BigInt(res.nonce),
    signature: res.signature as `0x${string}`,
    signerAddress: res.signer_address as `0x${string}`,
    chainId: res.chain_id,
    vaultAddress: res.vault_address as `0x${string}`,
  };
}
