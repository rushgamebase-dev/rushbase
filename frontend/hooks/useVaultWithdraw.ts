"use client";

/**
 * `useVaultWithdraw` — two-leg withdraw: ask the engine to sign an
 * EIP-191 authorization (validates free balance + on-chain vault
 * liquidity), then submit `TradingVault.withdraw(amount, nonce, sig)`
 * with the user's wallet. Engine never touches the chain in this
 * flow; the user pays gas and the contract verifies the engine's
 * signature.
 *
 * State machine:
 *   idle → signing → submitting → mining → done
 *                                       ↘ error
 */

import { useCallback, useEffect, useState } from "react";
import { parseEther } from "viem";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  TRADING_VAULT_ABI,
  TRADING_VAULT_ADDRESS,
} from "@/lib/contracts/tradingVault";
import {
  signWithdraw,
  type WithdrawAuthorization,
} from "@/lib/api/tapTradeVault";

export type WithdrawStep =
  | "idle"
  | "signing"
  | "submitting"
  | "mining"
  | "done"
  | "error";

interface WithdrawState {
  hash: `0x${string}` | null;
  authorization: WithdrawAuthorization | null;
  step: WithdrawStep;
  error: string | null;
}

export function useVaultWithdraw() {
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<WithdrawState>({
    hash: null,
    authorization: null,
    step: "idle",
    error: null,
  });

  const receipt = useWaitForTransactionReceipt({
    hash: state.hash ?? undefined,
  });

  useEffect(() => {
    if (state.hash && receipt.isSuccess && state.step === "mining") {
      setState((s) => ({ ...s, step: "done" }));
    }
  }, [state.hash, state.step, receipt.isSuccess]);

  const withdraw = useCallback(async (ethAmount: string) => {
    setState({ hash: null, authorization: null, step: "signing", error: null });
    let auth: WithdrawAuthorization | null = null;
    try {
      const amountWei = parseEther(ethAmount).toString();

      // 1. Engine signs (validates free balance + vault liquidity).
      auth = await signWithdraw(amountWei);
      setState({ hash: null, authorization: auth, step: "submitting", error: null });

      // 2. User submits to the vault. The contract verifies sig,
      // bumps nonce, and transfers ETH.
      const hash = await writeContractAsync({
        address: (auth.vaultAddress ?? TRADING_VAULT_ADDRESS) as `0x${string}`,
        abi: TRADING_VAULT_ABI,
        functionName: "withdraw",
        args: [BigInt(auth.amountWei), auth.nonce, auth.signature],
      });
      setState({ hash, authorization: auth, step: "mining", error: null });
      return { hash, authorization: auth };
    } catch (e) {
      setState({
        hash: null,
        authorization: auth,
        step: "error",
        error: friendlyError(e),
      });
      return null;
    }
  }, [writeContractAsync]);

  const reset = useCallback(() => {
    setState({ hash: null, authorization: null, step: "idle", error: null });
  }, []);

  return { ...state, withdraw, reset };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied/i.test(msg)) return "Transaction rejected";
  if (/Unauthorized/i.test(msg)) return "Sign in expired — reconnect wallet";
  if (/Insufficient balance/i.test(msg)) return "Insufficient free balance";
  if (/Vault liquidity too low/i.test(msg))
    return "Vault liquidity too low — try smaller amount";
  return msg.split("\n")[0]?.slice(0, 220) ?? "Withdraw failed";
}
