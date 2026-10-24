import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ScanLine,
  Upload,
  Settings2,
  Check,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  X,
  ImagePlus,
  ShieldCheck,
  WifiOff,
  AlertTriangle,
  LoaderCircle,
  Download,
  Layers3,
  Tag,
  Focus,
  Sun,
  StopCircle,
  PlugZap,
  CircleHelp,
  CheckCheck,
} from "lucide-react";
import {
  analyzeMaterial,
  connectModel,
  normalizeEndpoint,
  validateImage,
  resultFilename,
  ScanError,
  type ScanResult,
  type ModelInfo,
  type HeadPrediction,
} from "./scanner-client";
import "./scanner.css";
type T = (en: string, ur?: string) => string;
type Photo = { file: File; url: string };
export default function Scanner({
  t,
  onInventory,
}: {
  t: T;
  onInventory: () => void;
}) {
  const [endpoint, setEndpoint] = useState(() => {
    try {
      return (
        localStorage.getItem("yf-scanner-endpoint") ||
        import.meta.env.VITE_SCANNER_API_URL ||
        ""
      );
    } catch {
      return import.meta.env.VITE_SCANNER_API_URL || "";
    }
  });
  const [draftUrl, setDraftUrl] = useState(endpoint);
  const [configOpen, setConfigOpen] = useState(false);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [slot, setSlot] = useState<"surface" | "label">("surface");
  const [surface, setSurface] = useState<Photo | null>(null);
  const [label, setLabel] = useState<Photo | null>(null);
  const [labelText, setLabelText] = useState("");
  const [camera, setCamera] = useState(false);
  const [openingCamera, setOpeningCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const photoUrls = useRef(new Set<string>());
  const connectionRequest = useRef<AbortController | null>(null);
  const scanRequest = useRef<AbortController | null>(null);
  const cameraGeneration = useRef(0);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const activePhoto = slot === "surface" ? surface : label;
  const msg = (e: unknown) => {
    const code = e instanceof ScanError ? e.code : "server";
    return {
      endpoint: t(
        "Enter your TexPilot server URL, for example https://scanner.yourfactory.com.",
        "اپنے ٹیکس پائلٹ سرور کا درست URL درج کریں۔",
      ),
      insecure: t(
        "This published workspace needs an HTTPS model server. For a local HTTP server, use the local Yarnflow development app.",
        "اس شائع شدہ ورک اسپیس کے لیے HTTPS ماڈل سرور درکار ہے۔",
      ),
      unreachable: t(
        "Could not reach TexPilot. Check the server address, internet connection, and whether this workspace is allowed by the server. Your photo is still here.",
        "ٹیکس پائلٹ سے رابطہ نہیں ہوا۔ پتہ، انٹرنیٹ اور سرور کی اجازت چیک کریں۔ تصویر محفوظ ہے۔",
      ),
      timeout: t(
        "The model took too long to respond. Your photo is still here; try again when the server is ready.",
        "ماڈل کا جواب آنے میں زیادہ وقت لگا۔ تصویر برقرار ہے، دوبارہ کوشش کریں۔",
      ),
      aborted: t(
        "Analysis cancelled. Your photos are still available.",
        "تجزیہ روک دیا گیا۔ تصاویر برقرار ہیں۔",
      ),
      stub: t(
        "TexPilot is running without its trained model. Start the server with the scanner-v2 bundle; sample predictions are never shown here.",
        "ٹیکس پائلٹ میں تربیت یافتہ ماڈل لوڈ نہیں ہے۔ scanner-v2 کے ساتھ سرور چلائیں۔",
      ),
      response: t(
        "The server returned an unexpected result. Check that it serves the TexPilot scan API from main.",
        "سرور کا جواب متوقع فارمیٹ میں نہیں۔ main کا ٹیکس پائلٹ API چیک کریں۔",
      ),
      server: t(
        "The TexPilot server could not finish this request. Try again or check the model server.",
        "ٹیکس پائلٹ سرور درخواست مکمل نہیں کر سکا۔ دوبارہ کوشش کریں۔",
      ),
      unsupported: t(
        "Use a JPEG, PNG, or WebP photo. HEIC is not supported; choose Most Compatible in your phone’s camera settings.",
        "JPEG، PNG یا WebP تصویر استعمال کریں۔ HEIC دستیاب نہیں۔",
      ),
      "too-large": t(
        "This photo is larger than 10 MB. Choose a smaller photo or take a new camera capture.",
        "تصویر ۱۰ ایم بی سے بڑی ہے۔ چھوٹی تصویر یا نیا کیمرا شاٹ استعمال کریں۔",
      ),
      "invalid-image": t(
        "This photo could not be read. Choose a valid image or take another capture.",
        "تصویر پڑھی نہیں جا سکی۔ درست تصویر یا نیا شاٹ استعمال کریں۔",
      ),
      offline: t(
        "You are offline. Your selected photos stay here, but analysis needs your TexPilot server.",
        "آپ آف لائن ہیں۔ تجزیے کے لیے ٹیکس پائلٹ سرور سے رابطہ ضروری ہے۔",
      ),
    }[code];
  };
  function stopCamera() {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false);
    setOpeningCamera(false);
  }
  useEffect(() => {
    mounted.current = true;
    const network = () => setOnline(navigator.onLine);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      mounted.current = false;
      cameraGeneration.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      connectionRequest.current?.abort();
      scanRequest.current?.abort();
      photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current
        .play()
        .catch(() =>
          setCameraError(
            t(
              "Tap the video to start the preview, or upload a photo.",
              "پیش نظارہ شروع کریں یا تصویر اپ لوڈ کریں۔",
            ),
          ),
        );
    }
  }, [camera, t]);
  useEffect(() => {
    if (endpoint) void checkConnection(endpoint, false);
    // Nothing saved: quietly try this page's own server (the dev proxy serves the model).
    else void checkConnection(location.origin, true, "");
    return () => connectionRequest.current?.abort();
  }, [endpoint]);
  async function checkConnection(
    value: string,
    save: boolean,
    fallbackError?: string, // "" = stay quiet on failure
  ) {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnecting(true);
    setConnectionError("");
    setInfo(null);
    try {
      if (!navigator.onLine) throw new ScanError("offline");
      const clean = normalizeEndpoint(value, location.protocol === "https:");
      const data = await connectModel(clean, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (save) {
        localStorage.setItem("yf-scanner-endpoint", clean);
        setEndpoint(clean);
        setDraftUrl(clean);
      }
      setInfo(data);
      setConfigOpen(false);
    } catch (e) {
      if (!mounted.current || controller.signal.aborted) return;
      // A saved address goes stale when the host changes wifi. This page's own server is
      // the usual model host, so try it before reporting the original failure.
      if (!save && value !== location.origin) {
        void checkConnection(location.origin, true, msg(e));
        return;
      }
      if (fallbackError !== "") setConnectionError(fallbackError ?? msg(e));
    } finally {
      if (mounted.current && connectionRequest.current === controller)
        setConnecting(false);
    }
  }
  async function openCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      // No live preview here (phones allow it only over HTTPS): open the phone's own camera.
      nativeCamera.current?.click();
      return;
    }
    const generation = ++cameraGeneration.current;
    setOpeningCamera(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (!mounted.current || generation !== cameraGeneration.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
    } catch (e) {
      if (!mounted.current || generation !== cameraGeneration.current) return;
      const denied =
        e instanceof DOMException &&
        ["NotAllowedError", "PermissionDeniedError"].includes(e.name);
      setCameraError(
        denied
          ? t(
              "Camera access is blocked. Allow camera access in your browser, or use Upload photo.",
              "کیمرا کی اجازت نہیں۔ براؤزر میں اجازت دیں یا تصویر اپ لوڈ کریں۔",
            )
          : t(
              "The camera could not start. Close other camera apps, then try again or upload a photo.",
              "کیمرا شروع نہیں ہوا۔ دوسری کیمرا ایپس بند کریں یا تصویر اپ لوڈ کریں۔",
            ),
      );
    } finally {
      if (mounted.current && generation === cameraGeneration.current)
        setOpeningCamera(false);
    }
  }
  function choosePhoto(file: File) {
    try {
      validateImage(file);
      setError("");
      setCameraError("");
      setResult(null);
      const next = { file, url: URL.createObjectURL(file) };
      photoUrls.current.add(next.url);
      const old = slot === "surface" ? surface : label;
      if (old) {
        URL.revokeObjectURL(old.url);
        photoUrls.current.delete(old.url);
      }
      if (slot === "surface") setSurface(next);
      else setLabel(next);
      stopCamera();
    } catch (e) {
      setError(msg(e));
    }
  }
  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) {
      setCameraError(
        t(
          "Wait for the camera preview, then capture again.",
          "کیمرا پیش نظارہ آنے کے بعد دوبارہ شاٹ لیں۔",
        ),
      );
      return;
    }
    const canvas = document.createElement("canvas");
    const factor = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * factor);
    canvas.height = Math.round(v.videoHeight * factor);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob && mounted.current)
          choosePhoto(
            new File([blob], `${slot}-${Date.now()}.jpg`, {
              type: "image/jpeg",
            }),
          );
      },
      "image/jpeg",
      0.9,
    );
  }
  function removePhoto() {
    const photo = slot === "surface" ? surface : label;
    if (photo) {
      URL.revokeObjectURL(photo.url);
      photoUrls.current.delete(photo.url);
    }
    if (slot === "surface") setSurface(null);
    else setLabel(null);
    setResult(null);
    setError("");
  }
  async function analyze() {
    if (!surface || !endpoint || scanning) return;
    if (!online) {
      setError(msg(new ScanError("offline")));
      return;
    }
    stopCamera();
    setError("");
    setResult(null);
    setScanning(true);
    const controller = new AbortController();
    scanRequest.current = controller;
    try {
      const response = await analyzeMaterial(
        normalizeEndpoint(endpoint, location.protocol === "https:"),
        surface.file,
        label?.file || null,
        labelText,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) {
        setResult(response);
        setInfo({
          ready: true,
          model_version: response.model_version,
          mode: "scanner",
          verified: true,
        });
        setTimeout(() => resultHeading.current?.focus(), 0);
      }
    } catch (e) {
      if (mounted.current) setError(msg(e));
    } finally {
      if (mounted.current) setScanning(false);
    }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = resultFilename(result);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const labelFor = (value: string) =>
    ({
      cellulosic: t("Cellulosic", "سیلولوزی"),
      protein: t("Protein", "پروٹین"),
      synthetic: t("Synthetic", "مصنوعی"),
      blend: t("Blend", "مخلوط"),
      knit: t("Knit", "نِٹ"),
      woven: t("Woven", "وون"),
      cotton: t("Cotton", "کپاس"),
      polyester: t("Polyester", "پولیسٹر"),
      plain: t("Plain", "سادہ"),
      printed: t("Printed", "پرنٹ شدہ"),
      dyed: t("Dyed", "رنگا ہوا"),
      untreated: t("Untreated", "بغیر ٹریٹمنٹ"),
    })[value] || value.replaceAll("_", " ");
  const headRow = (
    en: string,
    ur: string,
    head: HeadPrediction | null,
    I: typeof Layers3,
    near?: [string, number][],
  ) => (
    <div className="scan-prediction">
      <span className="scan-prediction-icon">
        <I size={19} />
      </span>
      <div>
        <span>{t(en, ur)}</span>
        <strong>
          {head
            ? labelFor(head.label)
            : t("Not enough evidence", "شواہد ناکافی ہیں")}
        </strong>
        {!head && near && near.length > 0 && (
          <small className="scan-candidates">
            {t("Closest, not confident:", "قریب ترین، یقینی نہیں:")}{" "}
            <bdi>
              {near
                .map(([label, p]) => `${labelFor(label)} ${Math.round(p * 100)}%`)
                .join(" · ")}
            </bdi>
          </small>
        )}
      </div>
      {head ? (
        <div className="scan-confidence">
          <bdi>{Math.round(head.confidence * 100)}%</bdi>
          <span>
            <i style={{ width: head.confidence * 100 + "%" }} />
          </span>
        </div>
      ) : (
        <span className="scan-abstain">—</span>
      )}
    </div>
  );
  return (
    <div className="scanner-page">
      <div className="scan-topline">
        <span className="scan-model-badge">
          <span className={info ? "live-dot" : "offline-dot"} />
          {connecting
            ? t("Checking model…", "ماڈل چیک ہو رہا ہے…")
            : info
              ? info.verified
                ? t("TexPilot model connected", "ٹیکس پائلٹ ماڈل منسلک")
                : t(
                    "Server reachable · verify on scan",
                    "سرور دستیاب · اسکین پر تصدیق",
                  )
              : t("Model not connected", "ماڈل منسلک نہیں")}
        </span>
        <button
          className="button scan-connection-button"
          disabled={scanning}
          onClick={() => setConfigOpen(!configOpen)}
        >
          <Settings2 size={16} />
          {t("Model connection", "ماڈل کنکشن")}
        </button>
      </div>
      {configOpen && (
        <section className="scan-connect panel glass">
          <div className="scan-connect-heading">
            <span className="feature-icon">
              <PlugZap size={23} />
            </span>
            <div>
              <h2>
                {t(
                  "Connect your TexPilot model",
                  "اپنا ٹیکس پائلٹ ماڈل منسلک کریں",
                )}
              </h2>
              <p>
                {t(
                  "Connect the model server used by your factory.",
                  "اپنی فیکٹری کے ماڈل سرور سے منسلک ہوں۔",
                )}
              </p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void checkConnection(draftUrl, true);
            }}
          >
            <label htmlFor="scan-endpoint">
              {t("TexPilot server URL", "ٹیکس پائلٹ سرور URL")}
            </label>
            <div className="scan-url-row">
              <input
                id="scan-endpoint"
                type="url"
                required
                dir="ltr"
                placeholder="https://scanner.yourfactory.com"
                value={draftUrl}
                onChange={(e) => {
                  setDraftUrl(e.target.value);
                  setConnectionError("");
                }}
                disabled={connecting || scanning}
              />
              <button
                className="button primary"
                type="submit"
                disabled={connecting || scanning}
              >
                {connecting ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <PlugZap size={17} />
                )}{" "}
                {connecting
                  ? t("Connecting…", "منسلک ہو رہا ہے…")
                  : t("Connect model", "ماڈل منسلک کریں")}
              </button>
            </div>
          </form>
          <p className="scan-connect-note">
            {t(
              "The server URL is saved on this device. Photos go directly to your TexPilot server only when you choose Analyze material.",
              "سرور URL اس ڈیوائس پر محفوظ ہوگا۔ تجزیہ منتخب کرنے پر تصاویر آپ کے ٹیکس پائلٹ سرور کو بھیجی جائیں گی۔",
            )}
          </p>
          {connectionError && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              {connectionError}
            </div>
          )}
        </section>
      )}
      {!online && (
        <div className="info-banner" role="status">
          <WifiOff size={19} />
          {msg(new ScanError("offline"))}
        </div>
      )}
      {!configOpen && connectionError && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          {connectionError}
          <button className="text-button" onClick={() => setConfigOpen(true)}>
            {t("Check connection", "کنکشن چیک کریں")}
          </button>
        </div>
      )}
      <div className="scanner-grid">
        <section className="scan-capture-panel panel glass">
          <div className="panel-heading">
            <div>
              <h2>
                {t(
                  "A closer look at your material",
                  "اپنے یارن اور کپڑے کو قریب سے دیکھیں",
                )}
              </h2>
              <p>
                {t(
                  "Capture the fabric or garment in good, even light.",
                  "یکساں اور اچھی روشنی میں کپڑے یا گارمنٹ کی تصویر لیں۔",
                )}
              </p>
            </div>
            <span className="scan-step-count">
              <bdi>{slot === "surface" ? "01" : "02"}</bdi> / 02
            </span>
          </div>
          <div
            className="scan-photo-tabs"
            role="group"
            aria-label={t("Photo to capture", "تصویر کی قسم")}
          >
            <button
              disabled={scanning}
              aria-pressed={slot === "surface"}
              className={slot === "surface" ? "active" : ""}
              onClick={() => {
                stopCamera();
                setSlot("surface");
              }}
            >
              <span className="scan-tab-number">
                {surface ? <Check size={14} /> : "1"}
              </span>
              {t("Fabric / garment", "کپڑا / گارمنٹ")}
              {surface && (
                <span className="scan-photo-attached">
                  {t("Added", "شامل")}
                </span>
              )}
            </button>
            <button
              disabled={scanning}
              aria-pressed={slot === "label"}
              className={slot === "label" ? "active" : ""}
              onClick={() => {
                stopCamera();
                setSlot("label");
              }}
            >
              <span className="scan-tab-number">
                {label ? <Check size={14} /> : "2"}
              </span>
              {t("Care label", "کیئر لیبل")}
              <span className="scan-photo-attached">
                {label ? t("Added", "شامل") : t("Optional", "اختیاری")}
              </span>
            </button>
          </div>
          <div
            className={`scan-viewfinder ${activePhoto && !camera ? "has-photo" : ""} ${scanning ? "analyzing" : ""}`}
            aria-busy={scanning}
          >
            {camera ? (
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                aria-label={t("Live camera preview", "کیمرا پیش نظارہ")}
                onClick={() => video.current?.play()}
              />
            ) : activePhoto ? (
              <img
                src={activePhoto.url}
                alt={t(
                  slot === "surface"
                    ? "Selected fabric photo"
                    : "Selected care label photo",
                  slot === "surface"
                    ? "کپڑے کی منتخب تصویر"
                    : "کیئر لیبل کی منتخب تصویر",
                )}
              />
            ) : (
              <div className="scan-camera-empty">
                <span>
                  <Camera size={37} strokeWidth={1.3} />
                </span>
                <h3>
                  {slot === "surface"
                    ? t(
                        "Every material has a story.",
                        "ہر کپڑے کی ایک پہچان ہے۔",
                      )
                    : t(
                        "Let the label fill in the details.",
                        "لیبل سے مزید تفصیل حاصل کریں۔",
                      )}
                </h3>
                <p>
                  {slot === "surface"
                    ? t(
                        "Get close: fill the frame with the fabric, 10–15 cm away, so the weave is sharp.",
                        "قریب سے لیں: کپڑے کو 10–15 سینٹی میٹر سے پورے فریم میں لیں تاکہ بُنائی صاف نظر آئے۔",
                      )
                    : t(
                        "Fill the frame with the composition label. Keep the text sharp.",
                        "ترکیب والے لیبل کو فریم میں لیں، متن صاف رکھیں۔",
                      )}
                </p>
                <span className="scan-viewfinder-tip">
                  <Focus size={14} />
                  {t("Clear photo. Better evidence.", "صاف تصویر، بہتر شواہد۔")}
                </span>
              </div>
            )}
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            {(camera || activePhoto) && (
              <span className="scan-live-label">
                <span />
                {camera
                  ? t("CAMERA LIVE", "کیمرا فعال")
                  : t("READY TO ANALYZE", "تجزیے کے لیے تیار")}
              </span>
            )}
            {scanning && (
              <div className="scan-progress-overlay" role="status">
                <LoaderCircle className="spin" size={30} />
                <strong>
                  {t(
                    "TexPilot is taking a closer look…",
                    "ٹیکس پائلٹ تجزیہ کر رہا ہے…",
                  )}
                </strong>
                <span>
                  {t(
                    "Detecting fabric structure and checking the label.",
                    "کپڑے کی ساخت اور لیبل چیک ہو رہے ہیں۔",
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="scan-camera-controls">
            {camera ? (
              <>
                <button className="button" onClick={stopCamera}>
                  <StopCircle size={18} />
                  {t("Stop camera", "کیمرا بند کریں")}
                </button>
                <button className="button primary" onClick={capture}>
                  <Camera size={19} />
                  {t("Capture photo", "تصویر لیں")}
                </button>
              </>
            ) : (
              <>
                <button
                  className="button primary"
                  onClick={openCamera}
                  disabled={openingCamera || scanning}
                >
                  {openingCamera ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Camera size={19} />
                  )}{" "}
                  {openingCamera
                    ? t("Opening camera…", "کیمرا کھل رہا ہے…")
                    : activePhoto
                      ? t("Retake photo", "دوبارہ تصویر لیں")
                      : t("Open camera", "کیمرا کھولیں")}
                </button>
                <input
                  ref={nativeCamera}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) choosePhoto(file);
                    e.target.value = "";
                  }}
                />
                <label
                  className={`button scan-upload-button ${scanning ? "disabled" : ""}`}
                >
                  <Upload size={18} />
                  {t("Upload photo", "تصویر اپ لوڈ کریں")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                    disabled={scanning}
                    aria-label={t(
                      "Upload material photo",
                      "کپڑے کی تصویر اپ لوڈ کریں",
                    )}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) choosePhoto(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {activePhoto && (
                  <button
                    className="icon-button"
                    aria-label={t(
                      "Remove selected photo",
                      "منتخب تصویر ہٹائیں",
                    )}
                    disabled={scanning}
                    onClick={removePhoto}
                  >
                    <X size={18} />
                  </button>
                )}
              </>
            )}
          </div>
          {cameraError && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              {cameraError}
            </div>
          )}
          <div className="scan-photo-meta">
            <span>
              <ImagePlus size={14} />
              {activePhoto ? (
                <bdi>
                  {activePhoto.file.name} ·{" "}
                  {(activePhoto.file.size / 1024 / 1024).toFixed(1)} MB
                </bdi>
              ) : (
                t(
                  "JPEG, PNG or WebP · up to 10 MB",
                  "JPEG، PNG یا WebP · ۱۰ ایم بی تک",
                )
              )}
            </span>
            {surface && slot === "surface" && !label && (
              <button
                className="text-button"
                disabled={scanning}
                onClick={() => {
                  stopCamera();
                  setSlot("label");
                }}
              >
                {t("Add care label", "کیئر لیبل شامل کریں")}
                <ArrowRight size={13} />
              </button>
            )}
          </div>
          <details className="scan-manual-label">
            <summary>
              <Tag size={16} />
              {t("Type label composition instead", "لیبل کی ترکیب خود لکھیں")}
              <span>{t("Optional", "اختیاری")}</span>
            </summary>
            <label>
              {t(
                "Composition printed on the care label",
                "کیئر لیبل پر لکھی ترکیب",
              )}
              <textarea
                value={labelText}
                onChange={(e) => {
                  setLabelText(e.target.value);
                  setResult(null);
                }}
                maxLength={2000}
                rows={2}
                disabled={scanning}
                placeholder="60% cotton, 40% polyester"
              />
            </label>
            <p>
              {t(
                "Typed composition takes priority over the label photo.",
                "لکھی گئی ترکیب کو لیبل کی تصویر پر ترجیح دی جائے گی۔",
              )}
            </p>
          </details>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              {error}
            </div>
          )}
          <div className="scan-analyze-row">
            <span>
              <ShieldCheck size={16} />
              {t(
                "Real model results. No simulated predictions.",
                "اصل ماڈل کے نتائج۔ کوئی فرضی اندازہ نہیں۔",
              )}
            </span>
            {scanning ? (
              <button
                className="button"
                onClick={() => scanRequest.current?.abort()}
              >
                <X size={16} />
                {t("Cancel analysis", "تجزیہ روکیں")}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={!surface || !info || !online || connecting}
                onClick={analyze}
              >
                <ScanLine size={19} />
                {t("Analyze material", "کپڑے کا تجزیہ کریں")}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          {!info && (
            <p className="scan-analysis-hint">
              {t(
                "Capture or upload a photo, then connect your model to analyze it.",
                "تصویر لیں یا اپ لوڈ کریں، پھر تجزیے کے لیے ماڈل منسلک کریں۔",
              )}
            </p>
          )}
        </section>
        <aside className="scan-results-column">
          <section
            className={`scan-results panel glass ${result ? "has-result" : ""}`}
          >
            <div className="panel-heading">
              <div>
                <h2 ref={resultHeading} tabIndex={-1}>
                  {t("What the model sees", "ماڈل کیا دیکھتا ہے")}
                </h2>
                <p>
                  {t(
                    "Evidence first. A confident next step.",
                    "پہلے شواہد، پھر درست فیصلہ۔",
                  )}
                </p>
              </div>
              <span className="scan-result-icon">
                <Layers3 size={20} />
              </span>
            </div>
            {result ? (
              <>
                <div className={`scan-verdict ${result.verdict.toLowerCase()}`}>
                  <span>
                    {result.verdict === "PASS" ? (
                      <ShieldCheck size={24} />
                    ) : result.verdict === "FLAG" ? (
                      <AlertTriangle size={24} />
                    ) : (
                      <CircleHelp size={24} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {result.verdict === "PASS"
                        ? t("Consistent with the label", "لیبل کے مطابق")
                        : result.verdict === "FLAG"
                          ? t("Needs a closer look", "مزید جانچ ضروری")
                          : t("More evidence needed", "مزید شواہد درکار")}
                    </strong>
                    <p>
                      {result.verdict === "PASS"
                        ? t(
                            "No inconsistency was flagged by the model.",
                            "ماڈل نے کوئی تضاد ظاہر نہیں کیا۔",
                          )
                        : result.verdict === "FLAG"
                          ? t(
                              "Review the flagged evidence before accepting this material.",
                              "قبول کرنے سے پہلے دکھائے گئے شواہد دیکھیں۔",
                            )
                          : t(
                              "Try a clearer photo and add the care label.",
                              "صاف تصویر اور کیئر لیبل شامل کریں۔",
                            )}
                    </p>
                  </div>
                </div>
                <div className="scan-predictions">
                  {headRow(
                    "Fabric structure",
                    "کپڑے کی ساخت",
                    result.structure,
                    Layers3,
                    result.candidates.structure,
                  )}
                  {headRow(
                    "Surface treatment",
                    "سطح کی ٹریٹمنٹ",
                    result.treatment,
                    Sun,
                    result.candidates.treatment,
                  )}
                  {headRow(
                    "Fibre family",
                    "فائبر کی قسم",
                    result.fibre_family,
                    Tag,
                    result.candidates.fibre_family,
                  )}
                </div>
                {result.garment && (
                  <div className="scan-garment">
                    <span>{t("Garment detected", "گارمنٹ کی شناخت")}</span>
                    <strong>{labelFor(result.garment.label)}</strong>
                    {result.garment.confidence !== null && (
                      <bdi>{Math.round(result.garment.confidence * 100)}%</bdi>
                    )}
                  </div>
                )}
                <div className="scan-composition">
                  <span className="eyebrow">
                    {t("COMPOSITION FROM THE LABEL", "لیبل سے حاصل ترکیب")}
                  </span>
                  {result.stated_composition.fibers.length ? (
                    <div>
                      {result.stated_composition.fibers.map((fiber, i) => (
                        <span key={fiber.name + i}>
                          <bdi>{fiber.pct}%</bdi> {labelFor(fiber.name)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p>
                      {t(
                        "No composition was read. Add a label photo or type its text.",
                        "ترکیب پڑھی نہیں گئی۔ لیبل کی تصویر یا متن شامل کریں۔",
                      )}
                    </p>
                  )}
                </div>
                {result.flags.length > 0 && (
                  <div className="scan-flags">
                    <h3>{t("Things to review", "جائزے کے نکات")}</h3>
                    {result.flags.map((flag, i) => (
                      <div key={flag.code + i}>
                        <AlertTriangle size={15} />
                        <p>
                          {flag.message}
                          <small>
                            <bdi>{flag.code}</bdi>
                          </small>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="scan-quality">
                  <h3>{t("Capture quality", "تصویر کی کوالٹی")}</h3>
                  <div>
                    <span>
                      {t("Exposure", "روشنی")}
                      <strong>{result.capture_quality.exposure || "—"}</strong>
                    </span>
                    <span>
                      {t("Framing", "فریم")}
                      <strong>{result.capture_quality.framing || "—"}</strong>
                    </span>
                    <span>
                      {t("Sharpness score", "نفاست کا اسکور")}
                      <strong>
                        <bdi>
                          {result.capture_quality.blur === null
                            ? "—"
                            : result.capture_quality.blur.toFixed(1)}
                        </bdi>
                      </strong>
                    </span>
                  </div>
                </div>
                <div className="scan-result-meta">
                  <span>
                    <CheckCheck size={14} />
                    {t("Model", "ماڈل")}: <bdi>{result.model_version}</bdi>
                  </span>
                  <span>
                    {t("Scan", "اسکین")}: <bdi>{result.scan_id}</bdi>
                  </span>
                  <span>
                    {t("Scanned", "وقت")}:{" "}
                    <bdi>
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Asia/Karachi",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(result.timestamp))}
                    </bdi>
                  </span>
                </div>
                <div className="scan-result-actions">
                  <button className="button" onClick={download}>
                    <Download size={16} />
                    {t("Save result", "نتیجہ محفوظ کریں")}
                  </button>
                  <button className="text-button" onClick={onInventory}>
                    {t("Open inventory", "اسٹاک کھولیں")}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <div className="scan-empty-results">
                <div className="scan-empty-orbit">
                  <Layers3 size={35} strokeWidth={1.25} />
                  <span />
                  <span />
                </div>
                <h3>
                  {scanning
                    ? t(
                        "Finding the finer details…",
                        "باریک تفصیلات تلاش ہو رہی ہیں…",
                      )
                    : t(
                        "A little clarity starts here.",
                        "وضاحت کی شروعات یہاں سے۔",
                      )}
                </h3>
                <p>
                  {t(
                    "Your material’s structure, surface treatment, and fibre family will appear after analysis.",
                    "تجزیے کے بعد کپڑے کی ساخت، سطح اور فائبر کی قسم یہاں نظر آئے گی۔",
                  )}
                </p>
                <div className="scan-result-placeholders">
                  {[
                    [Layers3, "Fabric structure", "کپڑے کی ساخت"],
                    [Sun, "Surface treatment", "سطح کی ٹریٹمنٹ"],
                    [Tag, "Fibre family", "فائبر کی قسم"],
                  ].map(([I, en, ur]) => {
                    const C = I as typeof Layers3;
                    return (
                      <div key={String(en)}>
                        <C size={16} />
                        <span>{t(String(en), String(ur))}</span>
                        <i />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <section className="scan-tip-card glass">
            <span>
              <Focus size={19} />
            </span>
            <div>
              <h3>
                {t(
                  "Good light makes the difference.",
                  "اچھی روشنی سے بہتر نتیجہ۔",
                )}
              </h3>
              <p>
                {t(
                  "Use bright, even light, such as a window. Avoid flash and deep shadows. The fabric should fill the photo, not the room or the person wearing it.",
                  "روشن اور یکساں روشنی استعمال کریں، جیسے کھڑکی کی روشنی۔ فلیش اور گہرے سائے سے بچیں۔ تصویر میں کپڑا ہو، کمرہ یا پہننے والا نہیں۔",
                )}
              </p>
            </div>
          </section>
          <p className="scan-evidence-note">
            <ShieldCheck size={15} />
            {t(
              "Visual evidence helps verify material. Exact fibre percentages come from the care label, not the photo.",
              "تصویر سے مواد کی تصدیق میں مدد ملتی ہے۔ درست فیصد کیئر لیبل سے ملتا ہے۔",
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}
