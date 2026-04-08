/**
 * SinalBet Oracle — On-chain Publisher V2
 *
 * Supports commit-reveal flow with DataAttestation contract.
 * Called by round_manager.py with ACTION env var.
 *
 * Actions:
 *   commit    — Submit keccak256(count + salt) to DataAttestation
 *   reveal    — Reveal count + salt + metadata to DataAttestation
 *   consensus — Trigger ConsensusEngine.checkAndResolve()
 *
 * Usage:
 *   ACTION=commit ATTESTATION_DATA='{"commitHash":"0x..."}' node publisher_v2.js
 *   ACTION=reveal ATTESTATION_DATA='{"count":12,"salt":"0x...","streamUrlHash":"0x...","frameHash":"0x...","startTs":1234,"endTs":5678,"modelVersion":"yolov8s"}' node publisher_v2.js
 *   ACTION=consensus node publisher_v2.js
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';  // NOTE: mainnet, not sepolia

// ─── ABIs ─────────────────────────────────────────────────────

const ATTESTATION_ABI = parseAbi([
    'function commitResult(address market, bytes32 commitHash)',
    'function revealResult(address market, uint256 count, bytes32 salt, bytes32 streamUrlHash, bytes32 frameHash, uint256 startTs, uint256 endTs, string modelVersion)',
    'function commitCount(address market) view returns (uint256)',
    'function revealCount(address market) view returns (uint256)',
]);

const CONSENSUS_ABI = parseAbi([
    'function checkAndResolve(address market)',
    'function consensusReached(address market) view returns (bool)',
]);

// ─── Config ───────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
const MARKET_ADDRESS = process.env.MARKET_ADDRESS;
const ATTESTATION_ADDRESS = process.env.ATTESTATION_ADDRESS;
const CONSENSUS_ADDRESS = process.env.CONSENSUS_ADDRESS;
const ACTION = process.env.ACTION;
const ATTESTATION_DATA = process.env.ATTESTATION_DATA;

function requireEnv(name, value) {
    if (!value) {
        console.error(`Missing ${name} env var`);
        process.exit(1);
    }
    return value;
}

// ─── Actions ──────────────────────────────────────────────────

async function actionCommit(publicClient, walletClient, data) {
    const attestationAddr = requireEnv('ATTESTATION_ADDRESS', ATTESTATION_ADDRESS);

    if (!data.commitHash) {
        console.error('ATTESTATION_DATA must include "commitHash"');
        process.exit(1);
    }

    console.log(`Commit hash: ${data.commitHash}`);

    // Check current commit count
    const commits = await publicClient.readContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'commitCount',
        args: [MARKET_ADDRESS],
    });
    console.log(`Existing commits for market: ${commits}`);

    // Submit commit
    console.log('\nSending commitResult transaction...');

    const hash = await walletClient.writeContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'commitResult',
        args: [MARKET_ADDRESS, data.commitHash],
    });

    console.log(`TX hash: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // Verify new commit count
    const newCommits = await publicClient.readContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'commitCount',
        args: [MARKET_ADDRESS],
    });
    console.log(`Total commits after: ${newCommits}`);
}

async function actionReveal(publicClient, walletClient, data) {
    const attestationAddr = requireEnv('ATTESTATION_ADDRESS', ATTESTATION_ADDRESS);

    const requiredFields = ['count', 'salt', 'streamUrlHash', 'frameHash', 'startTs', 'endTs', 'modelVersion'];
    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            console.error(`ATTESTATION_DATA must include "${field}"`);
            process.exit(1);
        }
    }

    console.log(`Count: ${data.count}`);
    console.log(`Salt: ${data.salt}`);
    console.log(`Stream URL hash: ${data.streamUrlHash}`);
    console.log(`Frame hash: ${data.frameHash}`);
    console.log(`Window: ${data.startTs} -> ${data.endTs}`);
    console.log(`Model version: ${data.modelVersion}`);

    // Check current reveal count
    const reveals = await publicClient.readContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'revealCount',
        args: [MARKET_ADDRESS],
    });
    console.log(`Existing reveals for market: ${reveals}`);

    // Submit reveal
    console.log('\nSending revealResult transaction...');

    const hash = await walletClient.writeContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'revealResult',
        args: [
            MARKET_ADDRESS,
            BigInt(data.count),
            data.salt,
            data.streamUrlHash,
            data.frameHash,
            BigInt(data.startTs),
            BigInt(data.endTs),
            data.modelVersion,
        ],
    });

    console.log(`TX hash: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // Verify new reveal count
    const newReveals = await publicClient.readContract({
        address: attestationAddr,
        abi: ATTESTATION_ABI,
        functionName: 'revealCount',
        args: [MARKET_ADDRESS],
    });
    console.log(`Total reveals after: ${newReveals}`);
}

async function actionConsensus(publicClient, walletClient) {
    const consensusAddr = requireEnv('CONSENSUS_ADDRESS', CONSENSUS_ADDRESS);

    // Check if consensus already reached
    const alreadyReached = await publicClient.readContract({
        address: consensusAddr,
        abi: CONSENSUS_ABI,
        functionName: 'consensusReached',
        args: [MARKET_ADDRESS],
    });

    if (alreadyReached) {
        console.log('Consensus already reached for this market. Aborting.');
        return;
    }

    // Trigger checkAndResolve
    console.log('Sending checkAndResolve transaction...');

    const hash = await walletClient.writeContract({
        address: consensusAddr,
        abi: CONSENSUS_ABI,
        functionName: 'checkAndResolve',
        args: [MARKET_ADDRESS],
    });

    console.log(`TX hash: ${hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // Check outcome
    const reached = await publicClient.readContract({
        address: consensusAddr,
        abi: CONSENSUS_ABI,
        functionName: 'consensusReached',
        args: [MARKET_ADDRESS],
    });
    console.log(`Consensus reached: ${reached}`);
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
    console.log('SinalBet Oracle Publisher V2 (commit-reveal)');
    console.log('='.repeat(50));

    // Validate common env vars
    requireEnv('PRIVATE_KEY', PRIVATE_KEY);
    requireEnv('MARKET_ADDRESS', MARKET_ADDRESS);
    requireEnv('ACTION', ACTION);

    const validActions = ['commit', 'reveal', 'consensus'];
    if (!validActions.includes(ACTION)) {
        console.error(`Invalid ACTION "${ACTION}". Must be one of: ${validActions.join(', ')}`);
        process.exit(1);
    }

    console.log(`Action: ${ACTION}`);
    console.log(`Market: ${MARKET_ADDRESS}`);
    console.log(`RPC: ${RPC_URL}`);
    console.log(`Chain: Base Mainnet (${base.id})`);

    // Setup clients
    const account = privateKeyToAccount(PRIVATE_KEY);
    console.log(`Oracle wallet: ${account.address}`);

    const publicClient = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http(RPC_URL),
    });

    // Parse attestation data for commit/reveal
    let data = {};
    if (ACTION === 'commit' || ACTION === 'reveal') {
        if (!ATTESTATION_DATA) {
            console.error('ATTESTATION_DATA env var required for commit/reveal actions');
            process.exit(1);
        }
        try {
            data = JSON.parse(ATTESTATION_DATA);
        } catch (e) {
            console.error(`Failed to parse ATTESTATION_DATA: ${e.message}`);
            process.exit(1);
        }
    }

    // Dispatch action
    console.log(`\n--- ${ACTION.toUpperCase()} ---\n`);

    if (ACTION === 'commit') {
        await actionCommit(publicClient, walletClient, data);
    } else if (ACTION === 'reveal') {
        await actionReveal(publicClient, walletClient, data);
    } else if (ACTION === 'consensus') {
        await actionConsensus(publicClient, walletClient);
    }

    console.log(`\nDone. Action "${ACTION}" completed successfully.`);
}

main().catch(err => {
    console.error('Fatal error:', err.message || err);
    process.exit(1);
});
