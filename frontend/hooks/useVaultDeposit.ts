"use client";

/**
 * `useVaultDeposit` — wraps wagmi's `writeContract` for a payable
 * `TradingVault.deposit()` call. The engine listens for the on-chain
 * `Deposited(user, amount)` event and credits the user's off-chain
 * balance after `min_confirmations`.
 *
 * State machine:
 *   idle → submitting → mining → success
 *                      ↘ error
 *
 * The hook does not refresh the user's off-chain balance on its own;
 * the caller (e.g. WalletDrawer) calls `refreshBalance()` from
 * `useTapTradeAuth` once `isSuccess` flips, after waiting a beat for
 * the engine listener to catch up.
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

interface DepositState {
  hash: `0x${string}` | null;
  isSubmitting: boolean;
  isMining: boolean;
  isSuccess: boolean;
  error: string | null;
}

export function useVaultDeposit() {
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<DepositState>({
    hash: null,
    isSubmitting: false,
    isMining: false,
    isSuccess: false,
    error: null,
  });

  const receipt = useWaitForTransactionReceipt({
    hash: state.hash ?? undefined,
  });

  // Mirror the receipt's success into local state. We use an effect
  // (not inline `setState`-during-render) to keep React Strict Mode
  // happy and avoid the double-render warning.
  useEffect(() => {
    if (state.hash && receipt.isSuccess && !state.isSuccess) {
      setState((s) => ({ ...s, isMining: false, isSuccess: true }));
    }
  }, [state.hash, state.isSuccess, receipt.isSuccess]);

  const deposit = useCallback(
    async (ethAmount: string) => {
      setState({
        hash: null,
        isSubmitting: true,
        isMining: false,
        isSuccess: false,
        error: null,
      });
      try {
        const value = parseEther(ethAmount);
        const hash = await writeContractAsync({
          address: TRADING_VAULT_ADDRESS,
          abi: TRADING_VAULT_ABI,
          functionName: "deposit",
          value,
        });
        setState({
          hash,
          isSubmitting: false,
          isMining: true,
          isSuccess: false,
          error: null,
        });
        return hash;
      } catch (e) {
        const message = friendlyError(e);
        setState({
          hash: null,
          isSubmitting: false,
          isMining: false,
          isSuccess: false,
          error: message,
        });
        return null;
      }
    },
    [writeContractAsync]
  );

  const reset = useCallback(() => {
    setState({
      hash: null,
      isSubmitting: false,
      isMining: false,
      isSuccess: false,
      error: null,
    });
  }, []);

  return { ...state, deposit, reset };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied/i.test(msg)) return "Transaction rejected";
  if (/insufficient funds/i.test(msg))
    return "Insufficient ETH in wallet for value + gas";
  // Surface only the first line of long viem traces.
  return msg.split("\n")[0]?.slice(0, 220) ?? "Deposit failed";
}
