# rush-engine fuzz targets

Adversarial-input coverage that complements the proptest suite in
`tests/fuzz_parsers.rs`. The proptest invariants run on every
`cargo test` (256 cases per property by default). The cargo-fuzz
targets here run continuously in CI, exploring hours-deep state spaces
that proptest can't reach.

## Targets

| Binary | What it fuzzes | Surface |
|---|---|---|
| `fuzz_quote_token` | `QuoteSigner::verify` against any `&str` | `/trade/bets` body |
| `fuzz_der_signature` | `parse_ecdsa_der` + `normalize_low_s` | KMS Sign response |
| `fuzz_spki` | `parse_secp256k1_spki` | KMS GetPublicKey response |
| `fuzz_bigdecimal_to_u256` | `bd_to_u256`, `bd_to_i256` | Postgres NUMERIC round-trip |

## Running

cargo-fuzz needs a nightly toolchain (libfuzzer-sys requires nightly
features) and `cargo install cargo-fuzz`:

```bash
rustup install nightly
cargo install cargo-fuzz

# Smoke run (60 s)
cargo +nightly fuzz run fuzz_quote_token -- -max_total_time=60

# Deep fuzz overnight
cargo +nightly fuzz run fuzz_quote_token -- -max_total_time=28800

# AWS-KMS-gated targets
cargo +nightly fuzz run fuzz_der_signature --features aws-kms
cargo +nightly fuzz run fuzz_spki --features aws-kms
```

Crashes land in `fuzz/artifacts/<target>/`. Reproduce with:

```bash
cargo +nightly fuzz run fuzz_quote_token fuzz/artifacts/fuzz_quote_token/crash-<hash>
```

## CI integration

The Github Actions workflow runs each target for 5 minutes per PR
on `main`. Crash artifacts get uploaded as workflow artifacts and
auto-promoted into the proptest regression corpus. See
`.github/workflows/fuzz.yml` (TODO).
