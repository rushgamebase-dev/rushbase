// ============================================
// CONTRACT WRITER SERVICE - Submit transactions
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService, ABIS } from './blockchain.service';
import { RETRY_CONFIG, GAS_CONFIG } from '../config/contracts.config';
import { parseGwei, type Hash } from 'viem';

export interface TransactionResult {
  hash: Hash;
  success: boolean;
  gasUsed?: bigint;
  error?: string;
}

// Per-operation circuit breaker state
interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
  open: boolean;
}

@Injectable()
export class ContractWriterService {
  private readonly logger = new Logger(ContractWriterService.name);

  // Separate circuit breakers per operation type
  // Prevents VRF failures from blocking prize distribution and vice versa
  private breakers: Map<string, CircuitBreakerState> = new Map();

  constructor(private blockchain: BlockchainService) {}

  private getBreaker(operation: string): CircuitBreakerState {
    if (!this.breakers.has(operation)) {
      this.breakers.set(operation, { failureCount: 0, lastFailureTime: 0, open: false });
    }
    return this.breakers.get(operation)!;
  }

  // =============================================================
  //                    GAS HELPERS
  // =============================================================

  /**
   * Get explicit gas fee params to avoid viem's L1 fee overestimation on Base.
   * Without this, viem auto-calculates maxFeePerGas including L1 data costs,
   * which can spike to 0.7+ ETH during Ethereum L1 gas surges, causing
   * "insufficient funds" errors even when gas is actually cheap on Base.
   */
  private getGasParams(): { maxPriorityFeePerGas: bigint } {
    // Only set maxPriorityFeePerGas (tip). Let Viem auto-calculate maxFeePerGas
    // which correctly includes Base L2 execution + L1 data posting costs.
    // Capping maxFeePerGas was causing VRF and other txs to revert because
    // the cap (1 gwei) was too low for Viem's L1-aware fee estimation.
    return {
      maxPriorityFeePerGas: parseGwei('0.1'),
    };
  }

  // =============================================================
  //                    BATTLE ENGINE OPERATIONS
  // =============================================================

  /**
   * Submit battle result to BattleEngine contract
   */
  async submitBattleResult(
    arenaId: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    resultHash: `0x${string}`,
  ): Promise<TransactionResult> {
    this.checkCircuitBreaker('submitBattleResult');

    this.logger.log(
      `Submitting battle result: arenaId=${arenaId}, winnerId=${winnerId}, rounds=${totalRounds}`,
    );

    return this.executeWithRetry('submitBattleResult', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first to check for errors
      await publicClient.simulateContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'submitBattleResult',
        args: [arenaId, winnerId, totalRounds, resultHash],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'submitBattleResult',
        args: [arenaId, winnerId, totalRounds, resultHash],
        ...gasParams,
      });

      this.logger.log(`submitBattleResult tx submitted: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`submitBattleResult confirmed: block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('submitBattleResult');
        return {
          hash,
          success: true,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Commit a battle result hash (commit-reveal anti-spoiler)
   */
  async commitBattleResult(
    arenaId: bigint,
    commitHash: `0x${string}`,
  ): Promise<TransactionResult> {
    this.checkCircuitBreaker('commitBattleResult');

    this.logger.log(
      `Committing battle result: arenaId=${arenaId}, commitHash=${commitHash}`,
    );

    return this.executeWithRetry('commitBattleResult', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      await publicClient.simulateContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'commitBattleResult',
        args: [arenaId, commitHash],
        account: this.blockchain.getExecutorAddress(),
      });

      const hash = await walletClient.writeContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'commitBattleResult',
        args: [arenaId, commitHash],
        ...gasParams,
      });

      this.logger.log(`commitBattleResult tx submitted: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`commitBattleResult confirmed: block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('commitBattleResult');
        return { hash, success: true, gasUsed: receipt.gasUsed };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Reveal committed result and distribute prizes in one transaction
   */
  async revealAndDistribute(
    arenaId: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    resultHash: `0x${string}`,
    salt: `0x${string}`,
  ): Promise<TransactionResult> {
    this.checkCircuitBreaker('revealAndDistribute');

    this.logger.log(
      `Revealing and distributing: arenaId=${arenaId}, winnerId=${winnerId}, rounds=${totalRounds}`,
    );

    return this.executeWithRetry('revealAndDistribute', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      await publicClient.simulateContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'revealAndDistribute',
        args: [arenaId, winnerId, totalRounds, resultHash, salt],
        account: this.blockchain.getExecutorAddress(),
      });

      const hash = await walletClient.writeContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'revealAndDistribute',
        args: [arenaId, winnerId, totalRounds, resultHash, salt],
        ...gasParams,
      });

      this.logger.log(`revealAndDistribute tx submitted: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`revealAndDistribute confirmed: block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('revealAndDistribute');
        return { hash, success: true, gasUsed: receipt.gasUsed };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Distribute prizes after battle completion (legacy path — when commitReveal is disabled)
   */
  async distributePrizes(arenaId: bigint): Promise<TransactionResult> {
    this.checkCircuitBreaker('distributePrizes');

    this.logger.log(`Distributing prizes for arena: ${arenaId}`);

    return this.executeWithRetry('distributePrizes', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first
      await publicClient.simulateContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'distributePrizes',
        args: [arenaId],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'distributePrizes',
        args: [arenaId],
        ...gasParams,
      });

      this.logger.log(`distributePrizes tx submitted: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`distributePrizes confirmed: block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('distributePrizes');
        return {
          hash,
          success: true,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  // =============================================================
  //                    ARENA MANAGER OPERATIONS
  // =============================================================

  /**
   * Lock an arena (transition from OPEN to LOCKED state)
   */
  async lockArena(arenaId: bigint): Promise<TransactionResult> {
    this.checkCircuitBreaker('lockArena');

    this.logger.log(`Locking arena: ${arenaId}`);

    return this.executeWithRetry('lockArena', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first to check for errors
      await publicClient.simulateContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'lockArena',
        args: [arenaId],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'lockArena',
        args: [arenaId],
        ...gasParams,
      });

      this.logger.log(`lockArena tx submitted: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`lockArena confirmed: arenaId=${arenaId}, block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('lockArena');
        return {
          hash,
          success: true,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Cancel an arena and refund participants
   */
  async cancelArena(arenaId: bigint): Promise<TransactionResult> {
    this.checkCircuitBreaker('cancelArena');

    this.logger.log(`Cancelling arena: ${arenaId}`);

    return this.executeWithRetry('cancelArena', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first to check for errors
      await publicClient.simulateContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'cancelArena',
        args: [arenaId],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'cancelArena',
        args: [arenaId],
        ...gasParams,
      });

      this.logger.log(`cancelArena tx submitted: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`cancelArena confirmed: arenaId=${arenaId}, block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('cancelArena');
        return {
          hash,
          success: true,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Claim refund for a participant in a cancelled arena
   */
  async claimRefund(arenaId: bigint, agentId: bigint): Promise<TransactionResult> {
    this.checkCircuitBreaker('claimRefund');

    this.logger.log(`Claiming refund: arenaId=${arenaId}, agentId=${agentId}`);

    return this.executeWithRetry('claimRefund', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first
      await publicClient.simulateContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'claimRefund',
        args: [arenaId, agentId],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'claimRefund',
        args: [arenaId, agentId],
        ...gasParams,
      });

      this.logger.log(`claimRefund tx submitted: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`claimRefund confirmed: arenaId=${arenaId}, agentId=${agentId}`);
        this.resetCircuitBreaker('claimRefund');
        return { hash, success: true, gasUsed: receipt.gasUsed };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  /**
   * Request VRF randomness for an arena
   */
  async requestRandomness(arenaId: bigint): Promise<TransactionResult> {
    this.checkCircuitBreaker('requestRandomness');

    this.logger.log(`Requesting VRF randomness for arena: ${arenaId}`);

    return this.executeWithRetry('requestRandomness', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first to check for errors
      await publicClient.simulateContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'requestRandomness',
        args: [arenaId],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction with explicit gas limit for VRF (uses more gas than typical calls)
      const hash = await walletClient.writeContract({
        address: this.blockchain.battleEngineAddress,
        abi: ABIS.BattleEngine,
        functionName: 'requestRandomness',
        args: [arenaId],
        gas: 500_000n,
        ...gasParams,
      });

      this.logger.log(`requestRandomness tx submitted: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`requestRandomness confirmed: arenaId=${arenaId}, block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('requestRandomness');
        return {
          hash,
          success: true,
          gasUsed: receipt.gasUsed,
        };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  // =============================================================
  //                    CHAMPIONSHIP TROPHY OPERATIONS
  // =============================================================

  /**
   * Mint a soulbound championship trophy NFT
   */
  async mintTrophy(
    to: string,
    uri: string,
  ): Promise<{ hash: Hash; tokenId: number }> {
    this.checkCircuitBreaker('mintTrophy');

    this.logger.log(`Minting trophy to ${to} with URI: ${uri}`);

    return this.executeWithRetry('mintTrophy', async () => {
      const walletClient = this.blockchain.getWalletClient();
      const publicClient = this.blockchain.getPublicClient();
      const gasParams = this.getGasParams();

      // Simulate first
      const { result: tokenId } = await publicClient.simulateContract({
        address: this.blockchain.championshipTrophyAddress,
        abi: ABIS.ChampionshipTrophy,
        functionName: 'mint',
        args: [to as `0x${string}`, uri],
        account: this.blockchain.getExecutorAddress(),
      });

      // Execute transaction
      const hash = await walletClient.writeContract({
        address: this.blockchain.championshipTrophyAddress,
        abi: ABIS.ChampionshipTrophy,
        functionName: 'mint',
        args: [to as `0x${string}`, uri],
        ...gasParams,
      });

      this.logger.log(`mintTrophy tx submitted: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      if (receipt.status === 'success') {
        this.logger.log(`mintTrophy confirmed: tokenId=${tokenId}, block=${receipt.blockNumber}`);
        this.resetCircuitBreaker('mintTrophy');
        return { hash, tokenId: Number(tokenId) };
      } else {
        throw new Error('Transaction reverted');
      }
    });
  }

  // =============================================================
  //                    RETRY LOGIC
  // =============================================================

  private async executeWithRetry<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `[${operation}] failed (attempt ${attempt}/${RETRY_CONFIG.MAX_RETRIES}): ${lastError.message}`,
        );

        if (attempt < RETRY_CONFIG.MAX_RETRIES) {
          const backoff = Math.min(
            RETRY_CONFIG.INITIAL_BACKOFF_MS *
              Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt - 1),
            RETRY_CONFIG.MAX_BACKOFF_MS,
          );
          await this.sleep(backoff);
        }
      }
    }

    // All retries exhausted
    this.recordFailure(operation);
    throw lastError;
  }

  // =============================================================
  //                    CIRCUIT BREAKER (per-operation)
  // =============================================================

  private checkCircuitBreaker(operation: string): void {
    const breaker = this.getBreaker(operation);
    if (breaker.open) {
      const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
      if (timeSinceLastFailure > 60000) {
        // Reset after 1 minute
        breaker.open = false;
        breaker.failureCount = 0;
        this.logger.log(`Circuit breaker reset for [${operation}]`);
      } else {
        throw new Error(`Circuit breaker is open for [${operation}] - too many recent failures`);
      }
    }
  }

  private recordFailure(operation: string): void {
    const breaker = this.getBreaker(operation);
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failureCount >= 5) {
      breaker.open = true;
      this.logger.error(`Circuit breaker opened for [${operation}] - 5 consecutive failures`);
    }
  }

  private resetCircuitBreaker(operation: string): void {
    const breaker = this.getBreaker(operation);
    breaker.failureCount = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
