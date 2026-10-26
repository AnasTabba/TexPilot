import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEndpoint,
  validateImage,
  parseScanResult,
  connectModel,
  analyzeMaterial,
  analyzeSpec,
  parseSpecResult,
  validateScan,
  ScanError,
  leadingAnswer,
  type ScanResult,
  type SpecResult,
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
  candidates: {},
  custom: {},
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
test("Scanner keeps an abstaining head's closest matches, and older APIs without them still parse", () => {
  const candidates = { structure: [["knit", 0.32], ["crepe", 0.2]] };
  const abstain = { ...fixture, verdict: "INSUFFICIENT_EVIDENCE", structure: null, candidates };
  assert.deepEqual(parseScanResult(abstain).candidates, candidates);
  const { candidates: _, ...older } = { ...fixture, candidates: {} };
  assert.deepEqual(parseScanResult(older).candidates, {});
  for (const bad of [{ structure: [["knit", 1.5]] }, { structure: "knit" }, []])
    assert.throws(() => parseScanResult({ ...fixture, candidates: bad }), ScanError);
});
test("Scanner carries the yarn to buy, and older APIs without it still parse", () => {
  const lines = ["Warp: indigo-dyed cotton, Ne 7–12 (open-end or ring slub)"];
  assert.deepEqual(parseScanResult({ ...fixture, yarn_advice: lines }).yarn_advice, lines);
  assert.equal(parseScanResult(fixture).yarn_advice, undefined);
  for (const bad of ["Ne 30", [30], null])
    assert.throws(() => parseScanResult({ ...fixture, yarn_advice: bad }), ScanError);
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

const spec: SpecResult = {
  spec_id: "spec-1",
  construction: "woven",
  dpi: 1200,
  density: { ends_per_inch: 64, picks_per_inch: 42, spread_pct: 0.4, tiles: 36, skew_deg: 1.5 },
  weight_gsm: 390,
  yarn: {
    warp_ne: [6.6, 7.1],
    weft_ne: [6.6, 7.1],
    warp_standard_ne: 7,
    weft_standard_ne: 7,
    basis: "crimp 6-14% warp, 4-10% weft; weft assumed the same count as the warp",
  },
  stated_composition: { source: "care_label", fibers: [{ name: "cotton", pct: 100 }], ocr_confidence: null, section: null },
  yarn_order: ["Warp yarn: Ne 7s (range 6.6-7.1), 100% cotton"],
  flags: [{ code: "WEFT_ASSUMED", message: "Warp and weft are assumed to be the same count", severity: "info" }],
  timestamp: "2026-10-25T04:00:00Z",
};
test("Spec results are validated: real measurements pass, malformed ones are refused", () => {
  assert.deepEqual(parseSpecResult(spec), spec);
  assert.equal(parseSpecResult({ ...spec, yarn: null }).yarn, null);
  for (const bad of [
    { ...spec, density: { ...spec.density, ends_per_inch: -1 } },
    { ...spec, yarn: { ...spec.yarn, warp_ne: [7] } },
    { ...spec, construction: "felt" },
    { ...spec, yarn_order: "Ne 7" },
  ])
    assert.throws(() => parseSpecResult(bad), ScanError);
});
test("Spec scans accept flatbed TIFFs up to 60 MB and still refuse HEIC", () => {
  validateScan({ size: 40 * 1024 * 1024, type: "image/tiff", name: "swatch.tif" });
  validateScan({ size: 1000, type: "image/png", name: "swatch.png" });
  assert.throws(() => validateScan({ size: 1000, type: "image/heic", name: "a.heic" }), ScanError);
  assert.throws(() => validateScan({ size: 61 * 1024 * 1024, type: "image/tiff", name: "big.tif" }), ScanError);
});
test("Spec scan posts the scan, its scale, the weight and the label, and surfaces a 422 reason", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://model.example/api/v1/spec");
      const body = init?.body as FormData;
      assert.equal((body.get("scan_image") as File).name, "swatch.tif");
      assert.equal(body.get("dpi"), "1200");
      assert.equal(body.get("construction"), "woven");
      assert.equal(body.get("oz"), "11.5");
      assert.equal(body.get("gsm"), null);
      assert.equal(body.get("label_text"), "100% cotton");
      return Response.json(spec);
    };
    const scan = new File([new Uint8Array([73, 73, 42, 0])], "swatch.tif", { type: "image/tiff" });
    const out = await analyzeSpec("https://model.example", scan, {
      dpi: 1200, construction: "woven", weight: 11.5, unit: "oz", labelText: " 100% cotton ",
    });
    assert.equal(out.yarn?.warp_standard_ne, 7);
    globalThis.fetch = async () =>
      Response.json({ detail: "scan resolution unknown or below 300 dpi" }, { status: 422 });
    await assert.rejects(
      analyzeSpec("https://model.example", scan, { construction: "woven" }),
      (e) => e instanceof ScanError && e.code === "invalid-image" && e.detail.includes("300 dpi"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("A phone photo with the card: the card's measured size is sent, the scale's source is read", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = init?.body as FormData;
      assert.equal(body.get("dpi"), null);
      assert.equal(body.get("card_mm"), "29.5");
      return Response.json({ ...spec, dpi: 640.2, scale_source: "card" });
    };
    const photo = new File([new Uint8Array([255, 216, 255])], "fabric.jpg", { type: "image/jpeg" });
    const out = await analyzeSpec("https://model.example", photo, { construction: "woven", cardMm: 29.5 });
    assert.equal(out.scale_source, "card");
  } finally {
    globalThis.fetch = original;
  }
  assert.throws(() => parseSpecResult({ ...spec, scale_source: 3 }), ScanError);
  assert.equal(parseSpecResult(spec).scale_source, undefined); // older servers leave it out
});
test("The weave read from the scan is passed through; a malformed one is refused", () => {
  assert.equal(parseSpecResult({ ...spec, weave: "3/1 twill, right-hand" }).weave, "3/1 twill, right-hand");
  assert.equal(parseSpecResult({ ...spec, weave: null }).weave, null);
  assert.throws(() => parseSpecResult({ ...spec, weave: 31 }), ScanError);
});
test("Scanner shows heads the factory taught (e.g. wash), and older APIs without them still parse", () => {
  const custom = {
    wash: { label: "stone_wash", confidence: 0.93, topk: [["stone_wash", 0.93]] },
    finish: null,
  };
  assert.deepEqual(parseScanResult({ ...fixture, custom }).custom, custom);
  const { custom: _, ...older } = fixture;
  assert.deepEqual(parseScanResult(older).custom, {});
  for (const bad of [{ wash: { label: "x", confidence: 2, topk: [] } }, { wash: "stone" }, []])
    assert.throws(() => parseScanResult({ ...fixture, custom: bad }), ScanError);
});

test("answer card leads with the accepted answer, else a guess that beats the rest combined, else not sure", () => {
  assert.deepEqual(leadingAnswer({ label: "knit", confidence: 0.91 }, [["knit", 0.91]]), {
    lead: ["knit", 0.91], sure: true, rest: [],
  });
  assert.deepEqual(leadingAnswer(null, [["polyester", 0.84], ["elastane", 0.1]]), {
    lead: ["polyester", 0.84], sure: false, rest: [["elastane", 0.1]],
  });
  assert.deepEqual(leadingAnswer(null, [["yak", 0.29], ["acrylic", 0.21]]), {
    lead: null, sure: false, rest: [["yak", 0.29], ["acrylic", 0.21]],
  });
  assert.equal(leadingAnswer(null, [["a", 0.5], ["b", 0.5]]).lead, null);
  assert.deepEqual(leadingAnswer(null, undefined), { lead: null, sure: false, rest: [] });
});
