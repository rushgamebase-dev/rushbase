# Security Policy

## Reporting a Vulnerability

If you find a security issue in Rush -- whether in the smart contracts, oracle, frontend, or API -- please **do not open a public issue**. Instead, report it privately to:

**rushonbase@gmail.com**

Please include as much detail as possible:

- Affected component (contract address, repo path, endpoint, or page)
- A proof of concept or reproduction steps
- Potential impact (funds at risk, user data exposure, denial of service, etc.)
- Any mitigating circumstances or suggested fixes

We commit to responding within 72 hours and working with you on a fix timeline before any public disclosure.

## Scope

### In scope

- Smart contracts deployed at the addresses listed in [README.md](README.md)
- Oracle attestation, evidence, and market-creation logic
- Frontend at [rushgame.vip](https://rushgame.vip)
- REST API at `https://rushgame.vip/api/*`
- Any signing flow for the oracle wallet or dev wallet

### Out of scope

- Third-party services used by the protocol (Vercel, Cloudflare, Flaunch, Basescan, Ably) -- report those to their vendors directly
- Archived or dormant contracts that are not used in production (BurnMarketFactory, DataAttestation, ConsensusEngine, DisputeManager, OracleRegistry). If you believe an archived contract creates a live risk, please still email us.
- Social engineering of team members or users
- Issues requiring a compromised user wallet or private key

## Supported Versions

Only the deployments and versions currently in production (see addresses in [README.md](README.md)) are in scope for reports. Historical deploys labeled "Deprecated" or "Archived" are on a best-effort basis.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and service interruption
- Report issues only to the email above and give us a reasonable time to respond before any public disclosure
- Do not exploit the issue beyond what is necessary to demonstrate it

## Hall of Thanks

Researchers who report valid issues will be credited in release notes (unless they prefer to remain anonymous).
