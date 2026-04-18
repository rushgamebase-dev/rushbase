# Contributing to Rush

Thanks for wanting to contribute. Rush is a small protocol with a focused scope; PRs that make the product clearer, safer, or cheaper to operate are always welcome.

## Ground Rules

- **Open an issue first** for anything that is not a trivial fix. A 2-line description of the problem and the intended approach prevents wasted work.
- **One change per PR.** Mixing a bug fix with a refactor makes review much harder.
- **Keep the UI surface stable.** The contracts are immutable; changes that affect how users interact with them need extra scrutiny.
- **No new dependencies** in the hot path without discussing it first.

## Repository Layout

```
contracts/   Solidity sources, Foundry tests, deploy scripts
oracle/      Python detection engine, round manager, watchdog
frontend/    Next.js 14 app: pages, API routes, components, hooks
docs/        Public documentation (markdown)
ledger/      Generated output, not edited by hand
wave_engine/ Experimental standalone prototype (beach cameras)
```

## Development Setup

See [README.md](README.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for end-to-end instructions. Short version:

```bash
# Contracts
cd contracts && forge install && forge test

# Frontend
cd frontend && npm install && npm run dev

# Oracle (requires CUDA GPU)
cd oracle && pip install -r requirements.txt && python3 watchdog.py
```

## What a Good PR Looks Like

- **Title:** `<area>: <what changed>` -- e.g. `frontend: fix stale chain id on wallet switch` or `contracts: gas-optimize distributeAll loop`
- **Description:**
  - What the problem was (one paragraph, with a link to the issue if applicable)
  - What the change does (one paragraph)
  - How you tested it (commands, screenshots, or a short screencast)
- **Small and reviewable:** under ~300 lines changed when possible
- **No unrelated reformats.** Run `forge fmt` / `npm run lint` on files you actually edited, not on everything.

## Smart Contracts

- All new functionality needs Foundry unit tests. Follow the patterns in `contracts/test/*.t.sol`.
- Use `require` or custom errors with a clear revert reason -- never a silent `return` on failure.
- External calls must respect the checks-effects-interactions pattern.
- Any change that touches a production contract interface requires a new deployment and a synchronous update of `frontend/lib/contracts.ts` -- do both in the same PR.
- Run `slither .` locally before submitting. New findings must be explained in the PR description.

## Frontend

- TypeScript, strict mode, no `any` in new code.
- `wagmi` v2 requires `parseAbi()` on every ABI string -- do not pass raw strings.
- Keep new components colocated with the page or feature that uses them. Move them to `components/` only when they are shared across routes.
- Do not fetch chain state from inside a tight render loop; use hooks in `frontend/hooks/`.

## Oracle

- Do not introduce new background processes without a supervisor entry in `watchdog.py`.
- Any change to the detection pipeline must be validated end-to-end against at least one live camera before it is merged.
- Preserve the evidence-frame contract: every resolution still needs timestamped frames with SHA-256 hashes.

## Documentation

- If you change user-visible behavior, update the relevant page under `docs/` and the public `/docs` page in the frontend in the same PR.
- Keep examples runnable -- no placeholder addresses, no "coming soon" sections.

## Security

Never commit a private key, API key, or unredacted `.env`. Run `git diff --staged` before pushing. If you discover a vulnerability, please do **not** file a public issue -- see [SECURITY.md](SECURITY.md).

## License

All contributions are licensed under the MIT license of this repository. By opening a PR you confirm you have the right to contribute the code under that license.
