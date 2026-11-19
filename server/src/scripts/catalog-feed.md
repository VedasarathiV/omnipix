# OmniPix catalog feed runbook

The gateway's model catalog stays fresh through a signed feed: this machine
publishes, every install syncs twice daily. Wire contract (client side) lives
in `../services/catalog-sync.ts`; publishing lives in
`../services/catalog-feed.ts` plus the three scripts below.

## The loop

```
curated DB --export--> catalog.live.json --sign--> .sig --serve--> installs
```

1. **Curate.** Keep one database as the source of truth (add/retire models,
   adjust limits, edit quirks in the dashboard). User rows (`source='user'`)
   are never published.
2. **Export.** `tsx src/scripts/export-catalog.ts --db <curated.db>
   --out catalog.live.json --version YYYY.MM.DD --tier live`
   The version must be NEWER than the `MIN_CATALOG_VERSION` in the oldest
   binary you serve, or clients skip it as stale.
3. **Sign.** `tsx src/scripts/sign-catalog.ts --in catalog.live.json
   --key /path/to/feed-priv.pem`
   Signs the exact bytes served — re-sign after any edit.
4. **Serve.** `GET /v1/latest[?since=<version>]` must return the JSON bytes
   with an `x-catalog-signature` header (base64 Ed25519 over the bytes),
   and `304` when `?since=` matches the current version.
   `tsx src/scripts/serve-catalog.ts --file ... --sig ... --port 3399`
   does this for local/test feeds. Production wants any host that can set
   one response header (a 20-line Cloudflare Worker, nginx `add_header`,
   S3+CloudFront response-header policy). Plain GitHub Pages cannot set
   custom headers, so it cannot serve a feed directly.
5. **Clients.** Installs with `CATALOG_BASE_URL` set (or a binary whose
   pinned key matches) sync automatically. Proof: point a scratch install
   at the feed and watch `[catalog-sync] applied ...` in its log.

## Keys

- Mint: `tsx src/scripts/sign-catalog.ts --keygen --out-dir <dir>`.
- The private key is the feed. Back it up offline, never commit it, never
  paste it anywhere but the signer.
- Clients trust the public key pinned in `catalog-sync.ts`
  (`PINNED_CATALOG_PUBKEY`), overridable per-install via `CATALOG_PUBKEY`.
- Rotation: generate a new pair, ship the new public key in an app release,
  wait until installs have updated, then sign with the new private key.
  There is no multi-key support by design — one feed, one key.

## Monthly tier

`--tier monthly` publishes a snapshot for installs that trail the live feed.
Same bytes, same signature scheme; clients record whichever tier they apply
and never roll a live install back to a monthly document.

## Limits

- A retired platform (zero rows left) should ALSO be named in
  `managedPlatforms`, or built-in discovery treats it as unmanaged and
  re-adds guesses. The exporter omits the list today — hand-add retirements
  to the JSON before signing until the exporter learns tombstones.
- Feeds never carry user data: user rows, keys, and settings stay local.
