import type { ScanResult } from "./scanner-client";

export type FaultHeadline = { tone: "flag" | "pass" | "check"; en: string; ur: string };

/** Headline for the fault block; null hides it (no fault model, or the check did not run). */
export function faultHeadline(fault: ScanResult["fault"]): FaultHeadline | null {
  if (!fault || fault.skipped_reason) return null;
  if (fault.reference === "self_relative")
    return fault.is_fault
      ? {
          tone: "check",
          en: "Unusual area marked. Fabric unlike the fabrics the fault check learned: check by eye.",
          ur: "غیر معمولی حصہ نشان زد ہے۔ یہ کپڑا ان کپڑوں جیسا نہیں جن پر خرابی جانچنے والا ماڈل سکھایا گیا: آنکھ سے جانچیں۔",
        }
      : {
          tone: "check",
          en: "Fabric unlike the fabrics the fault check learned. Marked spots are only unusual areas: check by eye.",
          ur: "یہ کپڑا ان کپڑوں جیسا نہیں جن پر خرابی جانچنے والا ماڈل سکھایا گیا۔ نشان زد جگہیں صرف غیر معمولی حصے ہیں: آنکھ سے جانچیں۔",
        };
  return fault.is_fault
    ? { tone: "flag", en: "Possible fabric fault: look at the marked area", ur: "کپڑے میں ممکنہ خرابی: نشان زد حصے کو دیکھیں" }
    : { tone: "pass", en: "No fabric fault found", ur: "کپڑے میں کوئی خرابی نہیں ملی" };
}
