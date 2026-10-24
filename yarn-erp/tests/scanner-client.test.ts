import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEndpoint,
  validateImage,
  parseScanResult,
  connectModel,
  analyzeMaterial,
  ScanError,
  type ScanResult,
} from "../src/scanner-client.ts";
const fixture: ScanResult = {
  scan_id: "test-real-api-shape",
  verdict: "PASS",
  structure: { label: "knit", confidence: 0.91, topk: [["knit", 0.91]] },
  treatment: null,
  fibre_family: { label: "cellulosic", confidence: 0.93, topk: [] },
  garment: null,
  stated_composition: {
    source: "care_label",
    fibers: [{ name: "cotton", pct: 100 }],
    ocr_confidence: null,
    section: null,
  },
  flags: [],
  capture_quality: { blur: null, exposure: null, framing: null },
  model_version: "scanner-v2+det=gdino+ocr=apple",
  kb_version: "1",
  timestamp: "2026-10-24T14:00:00Z",
};
test("Scanner endpoint normalization preserves API prefixes and rejects credentials or insecure hosted endpoints", () => {
  assert.equal(
    normalizeEndpoint("https://model.example/api/v1/scan"),
    "https://model.example",
  );
  assert.equal(
    normalizeEndpoint("https://model.example/texpilot/"),
    "https://model.example/texpilot",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:pass@model.example",
    "https://model.example/?token=abc",
    "http://model.example",
  ])
    assert.throws(() => normalizeEndpoint(url), ScanError);
  assert.equal(
    normalizeEndpoint("http://127.0.0.1:8000", false),
    "http://127.0.0.1:8000",
  );
});
test("Scanner validates image type and size before sending any photo", () => {
  validateImage({ name: "fabric.jpg", type: "image/jpeg", size: 1024 });
  for (const file of [
    { name: "a.heic", type: "image/heic", size: 1024 },
    { name: "a.jpg", type: "image/jpeg", size: 0 },
    { name: "a.jpg", type: "image/jpeg", size: 11 * 1024 * 1024 },
  ])
    assert.throws(() => validateImage(file), ScanError);
});
test("Scanner renders real API evidence including normal abstention without inventing missing heads", () => {
  assert.deepEqual(parseScanResult(fixture), fixture);
  const abstain = {
    ...fixture,
    verdict: "INSUFFICIENT_EVIDENCE",
    structure: null,
    fibre_family: null,
  };
  assert.equal(parseScanResult(abstain).structure, null);
  assert.equal(parseScanResult(abstain).verdict, "INSUFFICIENT_EVIDENCE");
});
test("Scanner rejects stub outputs, invalid confidence and malformed result contracts", () => {
  assert.throws(
    () => parseScanResult({ ...fixture, model_version: "stub-0" }),
    (e) => e instanceof ScanError && e.code === "stub",
  );
  for (const data of [
    { ...fixture, structure: { label: "knit", confidence: 1.7, topk: [] } },
    {
      ...fixture,
      garment: { label: "shirt", confidence: 0.5, box: [0, 0, 2, 1] },
    },
    {
      ...fixture,
      stated_composition: {
        ...fixture.stated_composition,
        fibers: [{ name: "cotton", pct: 200 }],
      },
    },
    { ...fixture, timestamp: "wrong" },
    { hello: "not a scan" },
  ])
    assert.throws(() => parseScanResult(data), ScanError);
});
test("Scanner sends surface_image, label_image and label_text using the actual main API contract", async () => {
  const original = globalThis.fetch;
  let checked = false;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://model.example/api/v1/scan");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof FormData);
    assert.equal((init.body.get("surface_image") as File).name, "fabric.jpg");
    assert.equal((init.body.get("label_image") as File).name, "care.jpg");
    assert.equal(init.body.get("label_text"), "100% COTTON");
    assert.equal(init.headers, undefined);
    checked = true;
    return Response.json(fixture);
  };
  try {
    const file = new File([new Uint8Array([255, 216, 255])], "fabric.jpg", {
      type: "image/jpeg",
    });
    const label = new File([new Uint8Array([255, 216, 255])], "care.jpg", {
      type: "image/jpeg",
    });
    assert.equal(
      (
        await analyzeMaterial(
          "https://model.example",
          file,
          label,
          " 100% COTTON ",
        )
      ).model_version,
      fixture.model_version,
    );
    assert.ok(checked);
  } finally {
    globalThis.fetch = original;
  }
});
test("Scanner readiness never treats a healthy stub as a loaded model", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ ready: false, mode: "stub", model_version: "stub-0" });
  try {
    await assert.rejects(
      connectModel("https://model.example"),
      (e) => e instanceof ScanError && e.code === "stub",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Scanner supports older main API without claiming verified readiness", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/health")
      ? Response.json({ status: "ok" })
      : new Response(null, { status: 404 });
  try {
    assert.deepEqual(await connectModel("https://model.example"), {
      ready: true,
      mode: "unknown",
      verified: false,
      model_version: "",
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("Scanner upload errors preserve real server rejection instead of producing fake predictions", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ detail: "cannot decode image" }, { status: 422 });
  try {
    await assert.rejects(
      analyzeMaterial(
        "https://model.example",
        new File(["bad"], "fabric.jpg", { type: "image/jpeg" }),
        null,
        "",
      ),
      (e) => e instanceof ScanError && e.code === "invalid-image",
    );
  } finally {
    globalThis.fetch = original;
  }
});
