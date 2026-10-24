/** Wire contract: TexPilot main /services/api/schemas.py, POST /api/v1/scan. */
export interface HeadPrediction {
  label: string;
  confidence: number;
  topk: [string, number][];
}
export type HeadName = "structure" | "treatment" | "fibre_family";
export interface ScanResult {
  scan_id: string;
  verdict: "PASS" | "FLAG" | "INSUFFICIENT_EVIDENCE";
  structure: HeadPrediction | null;
  treatment: HeadPrediction | null;
  fibre_family: HeadPrediction | null;
  garment: {
    label: string;
    confidence: number | null;
    box: [number, number, number, number];
  } | null;
  stated_composition: {
    source: "care_label" | "purchase_order" | null;
    fibers: { name: string; pct: number }[];
    ocr_confidence: number | null;
    section: string | null;
  };
  flags: { code: string; message: string; severity: string }[];
  /** For heads that abstained: what they were weighing. Never a verdict. */
  candidates: Partial<Record<HeadName, [string, number][]>>;
  capture_quality: {
    blur: number | null;
    exposure: string | null;
    framing: string | null;
  };
  model_version: string;
  kb_version: string;
  timestamp: string;
}
export interface ModelInfo {
  ready: boolean;
  model_version: string;
  mode: string;
  verified: boolean;
}
export type ScanErrorCode =
  | "endpoint"
  | "insecure"
  | "offline"
  | "unreachable"
  | "timeout"
  | "aborted"
  | "invalid-image"
  | "too-large"
  | "response"
  | "stub"
  | "server"
  | "unsupported";
export class ScanError extends Error {
  code: ScanErrorCode;
  detail: string;
  constructor(code: ScanErrorCode, detail = "") {
    super(code);
    this.name = "ScanError";
    this.code = code;
    this.detail = detail;
  }
}
export function normalizeEndpoint(value: string, securePage = true): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ScanError("endpoint");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ScanError("endpoint");
  if (securePage && url.protocol !== "https:") throw new ScanError("insecure");
  return url.href.replace(/\/$/, "").replace(/\/api\/v1\/scan\/?$/, "");
}
export function validateImage(
  file: Pick<File, "size" | "type" | "name">,
): void {
  if (file.size === 0) throw new ScanError("invalid-image");
  if (file.size > 10 * 1024 * 1024) throw new ScanError("too-large");
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/bmp",
    ].includes(file.type)
  )
    throw new ScanError("unsupported");
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const score = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
function head(value: unknown): value is HeadPrediction | null {
  return (
    value === null ||
    (record(value) &&
      typeof value.label === "string" &&
      score(value.confidence) &&
      Array.isArray(value.topk) &&
      value.topk.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === "string" &&
          score(pair[1]),
      ))
  );
}
export function parseScanResult(value: unknown): ScanResult {
  if (
    !record(value) ||
    typeof value.scan_id !== "string" ||
    !["PASS", "FLAG", "INSUFFICIENT_EVIDENCE"].includes(
      String(value.verdict),
    ) ||
    typeof value.model_version !== "string" ||
    typeof value.kb_version !== "string" ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    !head(value.structure) ||
    !head(value.treatment) ||
    !head(value.fibre_family)
  )
    throw new ScanError("response");
  if (value.model_version.toLowerCase().includes("stub"))
    throw new ScanError("stub");
  const composition = value.stated_composition;
  const quality = value.capture_quality;
  if (
    !record(composition) ||
    ![null, "care_label", "purchase_order"].includes(
      composition.source as null,
    ) ||
    !Array.isArray(composition.fibers) ||
    !composition.fibers.every(
      (f) =>
        record(f) &&
        typeof f.name === "string" &&
        typeof f.pct === "number" &&
        Number.isFinite(f.pct) &&
        f.pct >= 0 &&
        f.pct <= 100,
    ) ||
    (composition.ocr_confidence !== null &&
      !score(composition.ocr_confidence)) ||
    (composition.section !== null && typeof composition.section !== "string")
  )
    throw new ScanError("response");
  if (
    !record(quality) ||
    (quality.blur !== null &&
      (typeof quality.blur !== "number" || !Number.isFinite(quality.blur))) ||
    (quality.exposure !== null && typeof quality.exposure !== "string") ||
    (quality.framing !== null && typeof quality.framing !== "string") ||
    !Array.isArray(value.flags) ||
    !value.flags.every(
      (f) =>
        record(f) &&
        typeof f.code === "string" &&
        typeof f.message === "string" &&
        typeof f.severity === "string",
    )
  )
    throw new ScanError("response");
  const garment = value.garment;
  if (
    garment !== null &&
    (!record(garment) ||
      typeof garment.label !== "string" ||
      (garment.confidence !== null && !score(garment.confidence)) ||
      !Array.isArray(garment.box) ||
      garment.box.length !== 4 ||
      !garment.box.every(score))
  )
    throw new ScanError("response");
  const candidates = value.candidates ?? {}; // absent from APIs before candidates existed
  if (
    !record(candidates) ||
    !Object.values(candidates).every(
      (list) =>
        Array.isArray(list) &&
        list.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === "string" &&
            score(pair[1]),
        ),
    )
  )
    throw new ScanError("response");
  return { ...(value as unknown as ScanResult), candidates };
}
async function request(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
  timeout = 10000,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    if (timedOut) throw new ScanError("timeout");
    if (controller.signal.aborted) throw new ScanError("aborted");
    throw new ScanError("unreachable", e instanceof Error ? e.message : "");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
export async function connectModel(
  endpoint: string,
  signal?: AbortSignal,
): Promise<ModelInfo> {
  const response = await request(
    endpoint + "/api/v1/model",
    { method: "GET" },
    signal,
  );
  if (response.status === 404) {
    const health = await request(
      endpoint + "/health",
      { method: "GET" },
      signal,
    );
    if (!health.ok) throw new ScanError("server");
    const payload: unknown = await health.json().catch(() => null);
    if (!record(payload) || payload.status !== "ok")
      throw new ScanError("response");
    return { ready: true, model_version: "", mode: "unknown", verified: false };
  }
  if (!response.ok) throw new ScanError("server");
  const value: unknown = await response.json().catch(() => null);
  if (
    !record(value) ||
    typeof value.ready !== "boolean" ||
    typeof value.model_version !== "string" ||
    typeof value.mode !== "string"
  )
    throw new ScanError("response");
  if (
    !value.ready ||
    value.model_version.toLowerCase().includes("stub") ||
    value.mode === "stub"
  )
    throw new ScanError("stub");
  return {
    ready: value.ready,
    model_version: value.model_version,
    mode: value.mode,
    verified: true,
  };
}
export async function analyzeMaterial(
  endpoint: string,
  surface: File,
  label: File | null,
  labelText: string,
  signal?: AbortSignal,
): Promise<ScanResult> {
  validateImage(surface);
  if (label) validateImage(label);
  const form = new FormData();
  form.append("surface_image", surface, surface.name);
  if (label) form.append("label_image", label, label.name);
  if (labelText.trim()) form.append("label_text", labelText.trim());
  const response = await request(
    endpoint + "/api/v1/scan",
    { method: "POST", body: form },
    signal,
    120000,
  );
  if (!response.ok) return failure(response);
  return parseScanResult(await body(response));
}
async function failure(response: Response): Promise<never> {
  let detail = "";
  try {
    const value: unknown = await response.json();
    if (record(value) && typeof value.detail === "string") detail = value.detail;
  } catch {
    /* The status remains useful without JSON. */
  }
  throw new ScanError(
    response.status === 413
      ? "too-large"
      : response.status === 422
        ? "invalid-image"
        : "server",
    detail,
  );
}
async function body(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ScanError("response");
  }
}

/** Wire contract: POST /api/v1/spec (services/api/spec.py): the yarn to order. */
export interface SpecResult {
  spec_id: string;
  construction: "woven" | "knit";
  dpi: number; // pixels per inch the threads were measured at
  scale_source?: "form" | "file" | "card" | null; // card: the printed TexPilot card
  density: {
    ends_per_inch: number; // knits: wales
    picks_per_inch: number; // knits: courses
    spread_pct: number;
    tiles: number;
    skew_deg: number;
  };
  weight_gsm: number | null;
  yarn: {
    warp_ne: [number, number];
    weft_ne: [number, number] | null;
    warp_standard_ne: number;
    weft_standard_ne: number | null;
    basis: string;
  } | null;
  stated_composition: ScanResult["stated_composition"];
  yarn_order: string[];
  flags: { code: string; message: string; severity: string }[];
  timestamp: string;
}
export interface SpecOptions {
  dpi?: number;
  construction: "woven" | "knit";
  weight?: number;
  unit?: "gsm" | "oz";
  labelText?: string;
  label?: File | null;
  cardMm?: number; // what the card's black square measures, if it did not print at 30 mm
}
const SCAN_TYPES = ["image/jpeg", "image/png", "image/tiff", "image/webp", "image/bmp"];
/** Flatbed scans: TIFF allowed (scanners' default), and larger than photos. */
export function validateScan(file: Pick<File, "size" | "type" | "name">): void {
  if (file.size === 0) throw new ScanError("invalid-image");
  if (file.size > 60 * 1024 * 1024) throw new ScanError("too-large");
  const tiffByName = !file.type && /\.tiff?$/i.test(file.name);
  if (!SCAN_TYPES.includes(file.type) && !tiffByName) throw new ScanError("unsupported");
}
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const range = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every(positive);
export function parseSpecResult(value: unknown): SpecResult {
  const d = record(value) ? value.density : null;
  const y = record(value) ? value.yarn : null;
  if (
    !record(value) ||
    typeof value.spec_id !== "string" ||
    !["woven", "knit"].includes(String(value.construction)) ||
    !positive(value.dpi) ||
    (value.scale_source != null && typeof value.scale_source !== "string") ||
    !record(d) ||
    !positive(d.ends_per_inch) ||
    !positive(d.picks_per_inch) ||
    typeof d.spread_pct !== "number" ||
    !Number.isInteger(d.tiles) ||
    typeof d.skew_deg !== "number" ||
    (value.weight_gsm !== null && !positive(value.weight_gsm)) ||
    (y !== null &&
      (!record(y) ||
        !range(y.warp_ne) ||
        (y.weft_ne !== null && !range(y.weft_ne)) ||
        !positive(y.warp_standard_ne) ||
        (y.weft_standard_ne !== null && !positive(y.weft_standard_ne)) ||
        typeof y.basis !== "string")) ||
    !record(value.stated_composition) ||
    !Array.isArray(value.stated_composition.fibers) ||
    !Array.isArray(value.yarn_order) ||
    !value.yarn_order.every((line) => typeof line === "string") ||
    !Array.isArray(value.flags) ||
    !value.flags.every(
      (f) =>
        record(f) &&
        typeof f.code === "string" &&
        typeof f.message === "string" &&
        typeof f.severity === "string",
    ) ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp))
  )
    throw new ScanError("response");
  return value as unknown as SpecResult;
}
export async function analyzeSpec(
  endpoint: string,
  scan: File,
  options: SpecOptions,
  signal?: AbortSignal,
): Promise<SpecResult> {
  validateScan(scan);
  if (options.label) validateImage(options.label);
  const form = new FormData();
  form.append("scan_image", scan, scan.name);
  form.append("construction", options.construction);
  if (options.dpi) form.append("dpi", String(options.dpi));
  if (options.cardMm) form.append("card_mm", String(options.cardMm));
  if (options.weight) form.append(options.unit === "oz" ? "oz" : "gsm", String(options.weight));
  if (options.labelText?.trim()) form.append("label_text", options.labelText.trim());
  if (options.label) form.append("label_image", options.label, options.label.name);
  const response = await request(
    endpoint + "/api/v1/spec",
    { method: "POST", body: form },
    signal,
    120000,
  );
  if (!response.ok) return failure(response);
  return parseSpecResult(await body(response));
}
export function resultFilename(result: ScanResult) {
  return (
    "texpilot-scan-" +
    result.scan_id.replace(/[^a-z0-9-]/gi, "").slice(0, 80) +
    ".json"
  );
}
