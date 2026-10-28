# Use Yarnflow on your iPhone and your friend's iPhone

## Open the live app

Open [Yarnflow](https://yarnflow-factory-glass.thryuil.chatgpt.site) in **Safari**. This is a web app: no App Store installation, TestFlight invitation, developer certificate or cable is needed.

The site keeps its existing private access policy. Sign in with the account authorized to visit it. If access is denied, the Site owner must grant access through its Share/access settings. Workspace invite codes do not bypass the site's access gate.

1. On the first phone, create a workspace, for example **Yarnflow testing**. You become its owner.
2. In **Inventory**, add a material with a unique SKU, then create its batch/dye lot.
3. Open the batch and choose **Receive stock**. Choose its stage, enter kg, cartons and cones, and save.
4. New stock needs a quality review. The owner chooses **Review quality**, records the actual physical inspection and approves or holds the batch.
5. **Move stock** transfers exact quantities between raw material, work in progress, finished stock and cops. **Dispatch** works only for approved stock. **Record waste** removes stock with an audit record.

## Add it to the Home Screen

1. In Safari, open the live link and sign in.
2. Tap **Share**, then **Add to Home Screen**. On versions that show **Open as Web App**, leave it enabled.
3. Tap **Add**. Open **Yarnflow** from the new icon.
4. Sign in again if iOS opens a separate app session. Allow Camera when the scanner asks.

Apple's [web app installation instructions](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios) describe the current Safari flow. Menu placement may differ by iOS version.

## Connect your friend's phone to the same inventory

There are two separate access steps:

1. **Site access:** the owner grants the friend's sign-in email access using the existing Site's Share/access settings. The app stays private; it is not made public just to share a test.
2. **Inventory membership:** in Yarnflow, open **Workspace → Create friend invite → Share invite**. Each invite can be used once and expires after 72 hours.

Your friend opens the invite in Safari, signs in with their own account, and chooses **Join workspace**. They should not create another workspace first. The friend becomes an operator: they can receive, move and dispatch approved stock and record inspections. Owner QC approval, exports and invites remain restricted to the owner.

Install the app on the second phone using the same Home Screen steps. Both phones now use the same database. The app refreshes while visible every ten seconds and when returning to the app; tap the refresh icon to check immediately. Your Mac does not need to stay on for the hosted inventory or stored photos.

## Test the scanner

### Stock labels — works independently of the AI model

1. Open a batch and choose **Print batch label**. The label contains a real QR code with the batch ID.
2. Print it, or show it on another screen.
3. On the other phone, choose **Scanner → Stock label → Open barcode camera**.
4. Scan the code. Yarnflow opens that exact batch and its shared balance.

You can also choose **Read barcode photo** or type the code/batch number. Product barcodes with several batches ask which batch you mean. This prevents one product barcode from silently selecting the wrong dye lot.

For a first test, receive 10 kg, move 3 kg to WIP, and check that both phones show 7 kg raw and 3 kg WIP. Try dispatching more than the balance: the server must reject it. Try dispatching an uninspected batch: the server must reject it. Once physically approved, dispatch a small valid quantity and check **Activity** on both phones.

### Fabric inspection

**Scanner → Fabric inspection** keeps the existing TexPilot capture/upload interface. To run AI analysis it needs a real HTTPS TexPilot server with this project's trained model bundle. Those trained weights were not present in this checkout or machine during this work; the web app cannot create them by installing an inventory system.

You can use **Record manual inspection** now: select a batch, record the care-label text and physical observations, and optionally take/upload a JPEG, PNG or WebP photo up to 10 MB. The photo is saved to shared object storage and is visible from the batch on either phone. Selection alone does not upload it.

If a real connected TexPilot server returns a result, **Attach scan to batch** saves the result as client-supplied evidence. It never silently approves QC. Exact fibre percentages are care-label claims, not a molecular measurement made from the photo. Missing model outputs and uncertainty remain visible.

Model recovery and startup: see [MODEL-LOCATION.md](MODEL-LOCATION.md) and [MODEL-CONNECTION.md](MODEL-CONNECTION.md). The compatible trained bundle needs `bundle.json` and `heads.safetensors`, plus any referenced head checkpoints.

## Offline and recovery

- Viewing already-open stock continues offline. Writes are paused; the app does not claim an offline movement was saved to the team.
- Movement drafts are saved on the current browser/device. Attached files must be reselected after closing/reloading a form; they are not stored in browser drafts.
- If a save times out, retry the same unchanged form. Movement IDs make that retry idempotent. Check Activity if the result is unclear.
- A correction uses **Activity → Reverse entry**, with a reason. It preserves the original. A receipt cannot be reversed if doing so would remove stock already consumed.
- **Workspace → Download workspace backup** exports structured data and movement history. It includes photo metadata, not the photo bytes; keep a separate R2 object backup for a full recovery. The JSON export is not an automatic restore feature.

## Local development

From `yarn-erp/`, use Node 24+:

```sh
npm ci
npm run build
npm run preview
```

This serves `http://127.0.0.1:8788` with an explicitly emulated development identity, a persistent SQLite database in `.local/inventory.sqlite`, and photo files in `.local/photos/`. It binds loopback and is not a production authentication server. Do not expose it as one.

For hot reload, keep the API running with `npm run api:dev`, then run `npm run dev -- --port 5174` in another terminal. Vite proxies `/api` to the local API. Use the hosted HTTPS URL for physical iPhone camera tests.

## Verification boundary

Automated WebKit iPhone emulation checks the browser workflows, QR-photo decoding and accessibility. It cannot certify physical iPhone camera focus, permission dialogs, printer output, Home Screen session behavior, or fabric-model accuracy. Those need the actual devices and model bundle. This is a hosted shared testing app, not a claim that a complete factory ERP or trained AI pipeline has been commissioned.
