# TexPilot app (P3)

Not scaffolded yet — pick your own Expo template rather than inherit one.

```bash
npx create-expo-app@latest . --template blank-typescript
```

## Responsibilities

1. **Camera capture** — two shots: fabric surface at 10–20 cm, and the care label.
2. **Capture-quality gating, on-device.** Blur (variance of Laplacian), exposure,
   framing. Reject a bad capture and re-prompt *before* uploading. Cheapest accuracy
   win available in the project, and it is product design rather than ML: it removes
   the worst inputs from the model's distribution entirely.
3. **Offline queue** — a factory goods-in desk will not always have wifi.
4. **Render three verdicts** — `PASS`, `FLAG`, and `INSUFFICIENT_EVIDENCE`. The
   abstain state is not an error screen; it is a normal, expected outcome and should
   look like one.

## API

The backend is live today and abstains until a model lands, so you are not blocked.

```bash
make api   # from the repo root
```

`POST /api/v1/scan` — multipart `surface_image`, optional `label_text`.
Schema at http://127.0.0.1:8000/docs, defined in `services/api/schemas.py`.

That file is a shared contract across all three workstreams — changes go through a PR
the others review.
