# Inventory backend shortlist — 24 October 2026

Star counts and latest default-branch commit dates were checked against the GitHub REST API on 24 October 2026. These are maintenance signals, not a guarantee of fitness or security. Use stable releases rather than deploying a development branch.

| Rank | Repository | Stars | Latest commit (UTC) | Backend / database | Yarnflow fit and customization |
|---|---|---:|---|---|---|
| 1 | [InvenTree](https://github.com/inventree/InvenTree) | 7,755 | [24 Oct 2026, 08:00](https://github.com/inventree/InvenTree/commit/cdb3b1ecf74ea2b9809ff8cdb2d4b61feba14829) | Python / Django; PostgreSQL deployment | Best focused inventory backend. Parts map to materials, stock items to batches, stock locations to stages/warehouses. REST API, plugins, stock history, barcodes and batch codes. MIT license. Keep fabric AI in TexPilot and attach evidence to batch QC. |
| 2 | [ERPNext](https://github.com/frappe/erpnext) | 40,537 | [24 Oct 2026, 15:07](https://github.com/frappe/erpnext/commit/5d5c27bc88862b8bd269664dbd87c8893c501e0c) | Python / Frappe; MariaDB | Best complete factory ERP: stock ledger, warehouses, batches, quality, purchasing, manufacturing and accounting. Customize with a separate Frappe app, custom fields and DocTypes. More services and more setup than a focused inventory API. GPL-3.0. |
| 3 | [Odoo Community](https://github.com/odoo/odoo) | 55,297 | [24 Oct 2026, 12:03](https://github.com/odoo/odoo/commit/475fa86f074d902b859e016b3462e2497ca885a6) | Python / JavaScript; PostgreSQL | Broad modular stock and manufacturing ecosystem. Extend with add-ons rather than editing core. Check the edition and module coverage: Community and Enterprise are distinct distributions. Community core is LGPL-3.0; individual add-on licensing varies. |
| 4 | [Dolibarr](https://github.com/Dolibarr/dolibarr) | 7,770 | [24 Oct 2026, 15:31](https://github.com/Dolibarr/dolibarr/commit/785876f9765971e0bb63eecd6f030aee25a96c50) | PHP; MySQL / MariaDB (other supported database options) | Practical SME stock, warehouse, supplier, order and invoicing modules. Hooks and modules are the customization route. Yarn processing and AI QC require domain-specific work. GPL-3.0. |
| 5 | [Snipe-IT](https://github.com/grokability/snipe-it) | 15,083 | [23 Oct 2026, 09:41](https://github.com/grokability/snipe-it/commit/95b7e49eb2c17267fcf3bcf02a7ae1f3a41d40eb) | PHP / Laravel; MySQL / MariaDB | Very established for serialized assets, accessories and consumables, with REST API and labels. Useful if the project grows into equipment tracking; weakest fit here for fractional-weight dye lots and manufacturing. AGPL-3.0. |

## Recommendation

Choose **InvenTree** for a smaller inventory service behind the existing React app, with an easier-to-modify REST boundary and permissive license. Choose **ERPNext** if purchasing, manufacturing work orders and accounting must share the same system from the start. High star count alone would put Odoo first; the narrower workflow fit puts InvenTree first for this project.

TexPilot's fabric verification model is a separate service. None of these inventory systems supplies this project's trained fabric weights or makes exact fibre-composition inference from an ordinary photograph valid.

## What the delivered app actually uses

The new hosted testing app uses **Yarnflow's own server-side inventory API, Cloudflare D1 for records, and R2 for inspection photos**. It does not run InvenTree, ERPNext, Odoo, Dolibarr or Snipe-IT. The repository choice remains open, as requested; the working shared testing database is not represented as an installed upstream ERP.

The old practice interface is still available at `/?practice=1` and keeps its separate browser-local sample stock. The new app never imports those sample balances automatically.

## InvenTree deployment material

`deploy/inventree/` includes the official InvenTree **1.6.1** Compose recipe, Caddy configuration and MIT license, pinned to source commit `be488919e4928cf16140b85d77058115a89cb4ef`. Release 1.6.1 was published on 21 October 2026. The environment example pins that release and removes the upstream example passwords.

The current machine has Docker's client but its daemon was not running. These containers were not started or claimed as tested. A PostgreSQL/Django service needs a persistent server; the Sites Worker hosting this app cannot run that Python service.

The app's owner-only InvenTree connection check uses server-side `INVENTREE_URL` and `INVENTREE_TOKEN`. It checks API access only. It does **not** synchronize stock, migrate the database or change stock authority. A future migration must map units, lot identifiers, QC and reversals and reconcile balances before switching over. Do not enable a second writer to the same physical stock without that reconciliation.

Primary references:

- [InvenTree Docker installation](https://docs.inventree.org/en/stable/start/docker/)
- [InvenTree stock API schema](https://docs.inventree.org/en/stable/api/schema/stock/)
- [InvenTree 1.6.1 source](https://github.com/inventree/InvenTree/tree/be488919e4928cf16140b85d77058115a89cb4ef)
- [ERPNext stock and inventory](https://frappe.io/erpnext/domains/inventory)
- [ERPNext batch tracking](https://docs.frappe.io/erpnext/batch)
