# Run TexPilot while the Mac is off

Prepared on 27 October 2026. **Not deployed:** this machine has no Modal login. The
deployment graph imports successfully with Modal 1.6.2, but its Linux image,
startup memory and scan latency still need remote verification. Yarnflow currently
continues to use its existing scanner URL.

## Free-budget option: Modal Starter, CPU, scale to zero

Modal currently supplies $30/month in free compute credits. It requires a payment
method even for Starter. Before uploading or deploying, open **Settings → Usage &
Billing** and set **Spend limit = $0**, and keep the usage budget within the
currently available free credits. The spend limit is the out-of-pocket cap; a $30
usage budget alone is not enough if credits expire or are used by another app.
Never upgrade the plan or raise the cap for this deployment.

This setup uses two CPU cores, 12 GiB RAM, at most one container and no permanently
warm container. It shuts down after 30 seconds without requests. The first scan
after sleeping can be slow. When free credits run out, scanning must stop until
credits renew; this is not unlimited free compute. No GPU is requested.

- [Current pricing](https://modal.com/pricing)
- [Billing requirements](https://modal.com/docs/guide/billing)
- [Spend limits](https://modal.com/docs/guide/budgets)

Hugging Face was checked with the existing AnasTabba account: creating a private
Docker Space on `cpu-basic` returned **402 Payment Required**, requiring Pro. No
Space or subscription was created. Oracle Always Free is another possible CPU
host (currently 2 OCPUs / 12 GB for free-only accounts), but requires an account and
available regional capacity; there is no configured Oracle account here.

## What is deployed

`modal_scanner.py` uploads only `services/`, scanner-v8, the scanner-v7 compatibility
encoder and the existing custom heads. It does not upload the repository's data,
training images, ledger, environment files or credentials. Public detector/DINO
weights and OCR assets are cached during image build. It retains v8; the completed
ensemble did not meet its promotion gate.

Linux uses the project's existing PaddleOCR implementation in an isolated venv,
because Apple's OCR is macOS-only. This needs a real label-photo check before
cutover. Scan records use a private Modal Volume; the Cloudflare D1 inventory
remains unchanged. Modal snapshots Volume writes in the background; check that a
record survives a container restart during validation. The volume is not a backup
of existing Mac scan history.

The endpoint requires Modal proxy authentication. Yarnflow's Worker adds the
server-only bearer token after checking the person's PIN session. Browser cookies
and browser-supplied credentials are never forwarded to the scanner.

## Deploy after account setup and $0-cap verification

From the repository root, with the ignored local model files still present:

```sh
python3 -m venv /tmp/texpilot-hosting-cli
/tmp/texpilot-hosting-cli/bin/pip install modal==1.6.2
/tmp/texpilot-hosting-cli/bin/modal token new
/tmp/texpilot-hosting-cli/bin/modal deploy deployment/modal_scanner.py
```

`modal deploy` creates a persistent deployment; it does not require the Mac to stay
on. Do not use `modal serve` as the production host: that session ends with the Mac.

Create a proxy token in Modal's dashboard (or `modal workspace proxy-tokens create`).
Its combined bearer credential is the token ID, a period, and the token secret.
Keep it out of Git and frontend settings. Use it to check the printed HTTPS endpoint:

1. Without credentials, `/api/v1/model` must return 401.
2. With credentials, `/api/v1/model` must return `ready: true`, `mode: scanner`,
   scanner-v8, `ocr=paddle`, and all six current taught head IDs.
3. Submit a real fabric photo and care-label photo to `/api/v1/scan`; confirm a real
   model version, meaningful outputs and OCR text. Do not write a test inspection
   to the live inventory.
4. Let the container sleep; repeat readiness and a scan within the client's
   120-second timeout. Inspect memory, latency and remaining credits. Verify the
   scan record survives restart. If these fail, retain the current endpoint.

After verification, preserve the old scanner URL for rollback, then store both
secrets using Wrangler's interactive prompts from `yarn-erp/`:

Stop any supervisor that reruns `scripts/scanner-tunnel.sh` before changing the
URL. That script overwrites `TEXPILOT_API_URL`; do not run it after hosted cutover
unless deliberately rolling back.

```sh
npx wrangler secret put TEXPILOT_API_TOKEN
npx wrangler secret put TEXPILOT_API_URL
npm run deploy:cloudflare
```

Paste the combined Modal credential for the first prompt and the deployment's
HTTPS origin for the second. Secrets never belong in `wrangler.jsonc` or the
browser's scanner connection field. The new Worker source supports either the
existing tunnel or the authenticated hosted service.

Then verify a real scan through Yarnflow while the Mac scanner/tunnel are stopped.
Do not stop them before the hosted scan works. For rollback, restore the old URL
and remove `TEXPILOT_API_TOKEN` with `wrangler secret delete TEXPILOT_API_TOKEN`.

## Verification performed locally

- Modal 1.6.2 imports the deployment graph; Ruff and Python syntax checks pass.
- Worker request tests cover private credentials, stripped session cookies,
  preserved multipart payloads, redirects blocked, HTTPS required for credentials,
  and the existing token-free tunnel.
- Scanner-client test covers a real-model readiness response after a simulated
  30-second cold start; the old 10-second timeout failed this case.
- Remote container build and real hosted inference remain blocked on account access.
