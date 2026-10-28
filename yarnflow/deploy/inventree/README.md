# Optional InvenTree server

These are upstream InvenTree 1.6.1 deployment files from source commit `be488919e4928cf16140b85d77058115a89cb4ef`. The Docker Compose file, Caddyfile and license are preserved; `.env.example` pins 1.6.1 and replaces upstream example credentials. This is an optional separate server. Yarnflow's live shared ledger does not depend on it or synchronize stock to it.

Use a persistent Linux server with Docker Compose, a domain pointing to it, persistent disk, and HTTP/HTTPS ports available for Caddy. This deployment contains PostgreSQL 17, Redis, the InvenTree web server, a background worker and Caddy. Protect and back up the persistent data directory and the generated `.env`.

From this directory:

```sh
node prepare-env.mjs https://inventory.YOUR-DOMAIN.example owner@YOUR-DOMAIN.example
docker compose config --quiet
docker compose pull
docker compose run --rm inventree-server invoke update
docker compose up -d
docker compose ps
```

`prepare-env.mjs` refuses to overwrite an existing `.env` and generates random database/admin passwords. Read the administrator credentials from that private file locally; do not commit or paste it into a chat. Initial migration/update and container health must succeed before using this server. The Docker daemon was not running in the authoring environment, so this upstream recipe was not executed here.

After the server is running, create an appropriately restricted API token through InvenTree's own account settings. Set the hosted app's **server-side** environment variables `INVENTREE_URL` and `INVENTREE_TOKEN`, then redeploy. `Workspace → Check InvenTree connection` performs a REST API access check. It does not migrate stock or make InvenTree authoritative.

For customization, maintain a separate plugin or small server-side adapter; do not modify the core stock tables behind InvenTree's back. Before changing stock authority, map Yarnflow material IDs to InvenTree parts, batches to stock items, stages to stock locations, and QC/reversal behavior to upstream stock operations. Reconcile every opening balance and test a backup restore. A complete migration has intentionally not been implied by a successful connection check.

[Official Docker setup](https://docs.inventree.org/en/stable/start/docker/) · [Pinned source](https://github.com/inventree/InvenTree/tree/be488919e4928cf16140b85d77058115a89cb4ef/contrib/container)
