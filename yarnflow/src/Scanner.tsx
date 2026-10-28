import { copy } from "./ui-copy";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Camera,
  ScanLine,
  Upload,
  Settings2,
  Check,
  ArrowRight,
  RefreshCw,
  X,
  ImagePlus,
  WifiOff,
  AlertTriangle,
  LoaderCircle,
  Download,
  Tag,
  Focus,
  StopCircle,
  PlugZap,
  CheckCheck,
  Blend,
  Paintbrush,
  Ruler,
  Shirt,
  Layers,
} from "lucide-react";
import {
  analyzeMaterial,
  connectModel,
  normalizeEndpoint,
  validateImage,
  resultFilename,
  topGuess,
  composition,
  ScanError,
  type ScanResult,
  type ModelInfo,
  type HeadPrediction,
} from "./scanner-client";
import ScannerArtwork from "./ScannerArtwork";
import type { ArtworkKind } from "./scanner-artwork";
type T = (en: string, ur?: string) => string;
type Photo = {
  file: File;
  url: string;
};
export default function Scanner({
  t,
  onInventory,
  onResult,
  onMeasure,
}: {
  t: T;
  onInventory: () => void;
  onResult?: (result: ScanResult) => void;
  /** Opens the Yarn spec scan (printed card + weight), which measures the exact count. */
  onMeasure?: () => void;
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
      endpoint: t(copy.enterYourTexpilotServerUrlForExample, copy.url),
      insecure: t(copy.thisPublishedWorkspaceNeedsAnHttpsModel, copy.https),
      unreachable: t(copy.couldNotReachTexpilotCheckTheServer, copy.urdu408),
      timeout: t(copy.theModelTookTooLongToRespond, copy.urdu409),
      aborted: t(
        copy.analysisCancelledYourPhotosAreStillAvailable,
        copy.urdu410,
      ),
      stub: t(copy.texpilotIsRunningWithoutItsTrainedModel, copy.scannerV2),
      response: t(copy.theServerReturnedAnUnexpectedResultCheck, copy.mainApi),
      server: t(copy.theTexpilotServerCouldNotFinishThis, copy.urdu411),
      unsupported: t(copy.useAJpegPngOrWebpPhoto, copy.jpegPngWebpHeic),
      "too-large": t(copy.thisPhotoIsLargerThan10Mb, copy.urdu412),
      "invalid-image": t(copy.thisPhotoCouldNotBeReadChoose, copy.urdu413),
      offline: t(copy.youAreOfflineYourSelectedPhotosStay, copy.urdu414),
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
          setCameraError(t(copy.tapTheVideoToStartThePreview, copy.urdu415)),
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
        (
          [copy.notallowederror, copy.permissiondeniederror] as string[]
        ).includes(e.name);
      setCameraError(
        denied
          ? t(copy.cameraAccessIsBlockedAllowCameraAccess, copy.urdu416)
          : t(copy.theCameraCouldNotStartCloseOther, copy.urdu417),
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
      setCameraError(t(copy.waitForTheCameraPreviewThenCapture, copy.urdu418));
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
        onResult?.(response);
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
      cellulosic: t(copy.cellulosic, copy.urdu419),
      protein: t(copy.protein, copy.urdu420),
      synthetic: t(copy.synthetic, copy.urdu421),
      blend: t(copy.blend, copy.urdu422),
      knit: t(copy.knit, copy.urdu423),
      woven: t(copy.woven, copy.urdu424),
      cotton: t(copy.cotton, copy.urdu425),
      polyester: t(copy.polyester, copy.urdu426),
      plain: t(copy.plain, copy.urdu427),
      printed: t(copy.printed, copy.urdu428),
      dyed: t(copy.dyed, copy.urdu429),
      untreated: t(copy.untreated, copy.urdu430),
      elastane_spandex: t("elastane (spandex)", "الاسٹین (اسپینڈیکس)"),
      viscose_rayon: t("viscose", "ویسکوز"),
      flax_linen: t("linen", "لینن"),
      t_shirt: t("T-shirt", "ٹی شرٹ"),
      dupatta_shawl: t("dupatta / shawl", "دوپٹہ / شال"),
    })[value] || value.replaceAll("_", " ");
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  // Taught heads (models/custom) report their raw class names; blends are named the way yarn is bought.
  const mixText = (key: string) =>
    key.split(",").map((part) => { const [fibre, pct] = part.split(":"); return `${pct}% ${taughtLabel("fibre", fibre)}`; }).join(" · ");
  const taughtLabel = (name: string, label: string) =>
    name === "blend"
      ? ({
          pure: t("Single fibre", "ایک ریشہ"),
          CVC: t("CVC (cotton-rich cotton/polyester)", "سی وی سی"),
          PC: t("PC (polyester-rich polyester/cotton)", "پی سی"),
          stretch: t("Stretch (with spandex/lycra)", "اسٹریچ"),
        })[label] ?? label
      : t(labelFor(label).replace(/^./, (c) => c.toUpperCase()));
  const fibreName = (label: string) =>
    ({
      cellulosic: t("Plant fibre (cotton, linen, viscose)", "پودوں کا ریشہ (کاٹن، لینن، ویسکوز)"),
      synthetic: t("Synthetic (polyester, nylon)", "مصنوعی (پولیسٹر، نائلون)"),
      protein: t("Animal fibre (wool, silk)", "جانوروں کا ریشہ (اون، ریشم)"),
    })[label] ?? labelFor(label);
  return (
    <div className="scanner-page">
      <div className="scan-topline">
        <span className={`scan-model-badge ${info ? "is-on" : ""}`}>
          {info ? <CheckCheck size={20} aria-hidden="true" /> : <WifiOff size={20} aria-hidden="true" />}
          {connecting
            ? t(copy.checkingModel, copy.urdu434)
            : info
              ? info.verified
                ? t(copy.texpilotModelConnected, copy.urdu435)
                : t(copy.serverReachableVerifyOnScan, copy.urdu436)
              : t(copy.modelNotConnected, copy.urdu437)}
        </span>
        <button
          className="live-icon-button"
          disabled={scanning}
          aria-label={t(copy.modelConnection, copy.urdu438)}
          title={t(copy.modelConnection, copy.urdu438)}
          onClick={() => setConfigOpen(!configOpen)}
        >
          <Settings2 size={18} aria-hidden="true" />
        </button>
      </div>
      {configOpen && (
        <section className="scan-connect panel">
          <div className="scan-connect-heading">
            <span className="feature-icon">
              <PlugZap size={23} />
            </span>
            <div>
              <h2>{t(copy.connectYourTexpilotModel, copy.urdu439)}</h2>
              <p>{t(copy.connectTheModelServerUsedByYour, copy.urdu440)}</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void checkConnection(draftUrl, true);
            }}
          >
            <label htmlFor="scan-endpoint">
              {t(copy.texpilotServerUrl, copy.url2)}
            </label>
            <div className="scan-url-row">
              <input
                id="scan-endpoint"
                type="url"
                required
                dir="ltr"
                placeholder={copy.httpsScannerYourfactoryCom}
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
                  ? t(copy.connecting, copy.urdu441)
                  : t(copy.connectModel, copy.urdu442)}
              </button>
            </div>
          </form>
          <p className="scan-connect-note">
            {t(copy.theServerUrlIsSavedOnThis, copy.url3)}
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
            {t(copy.checkConnection, copy.urdu443)}
          </button>
        </div>
      )}
      {/* Where the scan is: photo, optional care label, analysis, answer. */}
      <ol className="yf-steps yf-scansteps" aria-label="Scan steps">
        {([
          [t("Photograph", "تصویر"), !!surface],
          [t("Care label (optional)", "کیئر لیبل (اختیاری)"), !!label || !!labelText.trim()],
          [t("Analyse", "تجزیہ"), !!result],
          [t("Answer", "جواب"), !!result],
        ] as const).map(([name, done], i) => {
          const current = i === (!surface ? 0 : result ? 3 : 2);
          return (
            <li key={name} className={done ? "done" : current ? "current" : ""} aria-current={current ? "step" : undefined}>
              <span>{done ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
              {name}
            </li>
          );
        })}
      </ol>
      <div className="scanner-grid">
        <section className="scan-capture-panel panel">
          <div className="panel-heading">
            <div>
              <h2>{t(copy.aCloserLookAtYourMaterial, copy.urdu444)}</h2>
              <p>{t(copy.captureTheFabricOrGarmentInGood, copy.urdu445)}</p>
            </div>
          </div>
          <div
            className="scan-photo-tabs"
            role="group"
            aria-label={t(copy.photoToCapture, copy.urdu446)}
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
              {t(copy.fabricGarment, copy.urdu447)}
              {surface && (
                <span className="scan-photo-attached">
                  {t(copy.added, copy.urdu448)}
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
              {t(copy.careLabel, copy.urdu449)}
              <span className="scan-photo-attached">
                {label
                  ? t(copy.added, copy.urdu448)
                  : t(copy.optional, copy.urdu450)}
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
                aria-label={t(copy.liveCameraPreview, copy.urdu451)}
                onClick={() => video.current?.play()}
              />
            ) : activePhoto ? (
              <img
                src={activePhoto.url}
                alt={t(
                  slot === "surface"
                    ? copy.selectedFabricPhoto
                    : copy.selectedCareLabelPhoto,
                  slot === "surface" ? copy.urdu452 : copy.urdu453,
                )}
              />
            ) : (
              <div className="scan-camera-empty">
                <span>
                  <Camera size={37} strokeWidth={1.75} />
                </span>
                <h3>
                  {slot === "surface"
                    ? t(copy.everyMaterialHasAStory, copy.urdu454)
                    : t(copy.letTheLabelFillInTheDetails, copy.urdu455)}
                </h3>
                <p>
                  {slot === "surface"
                    ? t(copy.getCloseFillTheFrameWithFabric, copy.getCloseFillTheFrameWithFabricUr)
                    : t(copy.fillTheFrameWithTheCompositionLabel, copy.urdu457)}
                </p>
                <span className="scan-viewfinder-tip">
                  <Focus size={14} />
                  {t(copy.clearPhotoBetterEvidence, copy.urdu458)}
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
                  ? t(copy.cameraLive, copy.urdu459)
                  : t(copy.readyToAnalyze, copy.urdu460)}
              </span>
            )}
            {scanning && (
              <div className="scan-progress-overlay" role="status">
                {/* A loom at work: warp threads lift in turn while the weft shuttles across. */}
                <span className="weave-loader" aria-hidden="true">
                  <i /><i /><i /><i /><i /><i /><b />
                </span>
                <strong>
                  {t(copy.texpilotIsTakingACloserLook, copy.urdu461)}
                </strong>
                <span>
                  {t(
                    copy.detectingFabricStructureAndCheckingTheLabel,
                    copy.urdu462,
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
                  {t(copy.stopCamera, copy.urdu463)}
                </button>
                <button className="button primary" onClick={capture}>
                  <Camera size={19} />
                  {t(copy.capturePhoto, copy.urdu464)}
                </button>
              </>
            ) : (
              <>
                <button
                  className="button"
                  onClick={openCamera}
                  disabled={openingCamera || scanning}
                >
                  {openingCamera ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Camera size={19} />
                  )}{" "}
                  {openingCamera
                    ? t(copy.openingCamera, copy.urdu465)
                    : activePhoto
                      ? t(copy.retakePhoto, copy.urdu466)
                      : t(copy.openCamera, copy.urdu467)}
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
                  {t(copy.uploadPhoto, copy.urdu468)}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                    disabled={scanning}
                    aria-label={t(copy.uploadMaterialPhoto, copy.urdu469)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) choosePhoto(file);
                      e.target.value = "";
                    }}
                  />
                </label>
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
            {activePhoto && <span>
              <ImagePlus size={14} />
              {activePhoto ? (
                <bdi>
                  {activePhoto.file.name}
                  {copy.urdu21}{" "}
                  {(activePhoto.file.size / 1024 / 1024).toFixed(1)}
                  {copy.mb}
                </bdi>
              ) : null}
            </span>}
            {activePhoto && !camera && (
              <button
                className="text-button"
                disabled={scanning}
                onClick={removePhoto}
                aria-label={t(copy.removeSelectedPhoto, copy.urdu470)}
              >
                <X size={16} aria-hidden="true" />
                {t("Remove", "ہٹائیں")}
              </button>
            )}
          </div>
          <details className="scan-manual-label">
            <summary>
              <Tag size={16} />
              {t(copy.typeLabelCompositionInstead, copy.urdu472)}
              <span>{t(copy.optional, copy.urdu450)}</span>
            </summary>
            <label>
              {t(copy.compositionPrintedOnTheCareLabel, copy.urdu473)}
              <textarea
                value={labelText}
                onChange={(e) => {
                  setLabelText(e.target.value);
                  setResult(null);
                }}
                maxLength={2000}
                rows={2}
                disabled={scanning}
                placeholder={copy.label60Cotton40Polyester}
              />
            </label>
            <p>
              {t(copy.typedCompositionTakesPriorityOverTheLabel, copy.urdu474)}
            </p>
          </details>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              {error}
            </div>
          )}
          <div className="scan-analyze-row">
            <span />
            {scanning ? (
              <button
                className="button"
                onClick={() => scanRequest.current?.abort()}
              >
                <X size={16} />
                {t(copy.cancelAnalysis, copy.urdu476)}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={!surface || !info || !online || connecting}
                onClick={analyze}
              >
                <ScanLine size={19} />
                {t(copy.analyzeMaterial, copy.urdu477)}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          {!info && (
            <p className="scan-analysis-hint">
              {t(copy.captureOrUploadAPhotoThenConnect, copy.urdu478)}
            </p>
          )}
        </section>
        <aside className="scan-results-column">
          <section
            className={`scan-results panel ${result ? "has-result" : ""}`}
          >
            <div className="panel-heading">
              <div>
                <h2 ref={resultHeading} tabIndex={-1}>
                  {t(copy.whatTheModelSees, copy.urdu479)}
                </h2>
                <p>{t(copy.evidenceFirstAConfidentNextStep, copy.urdu480)}</p>
              </div>
            </div>
            {result ? (() => {
              // Every row shows the model's top answer with its confidence (colour-coded), never "not sure".
              const garment =
                topGuess(result.custom.garment_type, result.candidates.garment_type) ??
                (result.garment ? ([result.garment.label, result.garment.confidence ?? 0] as [string, number]) : null);
              const stated = result.stated_composition.fibers;
              // Composition the way yarn is bought: 100% cotton, cotton + spandex, CVC, PC (blend head + fibre head).
              // The taught "mix" head names the exact mix ("cotton:98,elastane_spandex:2"); else the blend head's group.
              const mix = topGuess(result.custom.mix, result.candidates.mix);
              const comp = composition(result);
              const fibreWord = comp?.fibre ? taughtLabel("fibre", comp.fibre) : "";
              const compText = !comp ? "" : comp.blend === "pure" ? (fibreWord ? `100% ${fibreWord}` : t("Single fibre (100%)", "ایک ریشہ"))
                : comp.blend === "stretch" ? (fibreWord ? `${fibreWord} + spandex (stretch)` : t("Stretch (with spandex)", "اسٹریچ"))
                : comp.blend === "CVC" ? t("CVC: cotton-rich cotton/polyester", "سی وی سی: زیادہ کاٹن، کچھ پولیسٹر")
                : comp.blend === "PC" ? t("PC: polyester-rich polyester/cotton", "پی سی: زیادہ پولیسٹر، کچھ کاٹن")
                : fibreWord;
              const rows = [
                { key: "fabric", title: t("Fabric", "کپڑا"), art: "structure" as const, guess: topGuess(result.structure, result.candidates.structure), name: (l: string) => taughtLabel("structure", l) },
                stated.length
                  ? { key: "composition", title: t("Composition (from the label)", "بناوٹ (لیبل سے)"), icon: Blend, guess: null,
                      text: stated.map((f) => `${f.pct}% ${labelFor(f.name)}`).join(" · ") }
                  : mix
                    ? { key: "composition", title: t("Composition", "بناوٹ"), icon: Blend, guess: mix, name: mixText }
                    : { key: "composition", title: t("Composition", "بناوٹ"), icon: Blend, guess: comp ? ([comp.blend ?? comp.fibre ?? "", comp.p] as [string, number]) : null, name: () => compText },
                { key: "finish", title: t("Finish", "فنش"), icon: Paintbrush, guess: topGuess(result.custom.finish, result.candidates.finish), name: (l: string) => taughtLabel("finish", l) },
                { key: "pattern", title: t("Pattern", "پیٹرن"), icon: ScanLine, guess: topGuess(result.custom.pattern, result.candidates.pattern), name: (l: string) => taughtLabel("pattern", l) },
              ];
              const level = (p: number) => (p >= 0.8 ? "high" : p >= 0.5 ? "mid" : "low");
              return (
              <>
                <div className="scan-garment-hero">
                  <ScannerArtwork kind="garment" label={garment?.[0]} />
                  <div>
                    <span>{t("Garment", "لباس")}</span>
                    <h3>{garment ? taughtLabel("garment_type", garment[0]) : t("No garment found", "کوئی لباس نہیں ملا")}</h3>
                  </div>
                  {garment && <b className={`scan-pct ${level(garment[1])}`}>{pct(garment[1])}</b>}
                </div>
                <ul className="scan-rows">
                  {rows.map((r) =>
                    r.guess || r.text ? (
                      <li key={r.key}>
                        {r.art && r.guess ? (
                          <ScannerArtwork kind={r.art} label={r.guess[0]} />
                        ) : (
                          <span className="scan-row-icon">{r.icon && <r.icon size={24} aria-hidden="true" />}</span>
                        )}
                        <div>
                          <span>{r.title}</span>
                          <strong>{r.guess && r.name ? r.name(r.guess[0]) : r.text}</strong>
                        </div>
                        {r.guess && <b className={`scan-pct ${level(r.guess[1])}`}>{pct(r.guess[1])}</b>}
                      </li>
                    ) : null,
                  )}
                </ul>
                {result.verdict !== "INSUFFICIENT_EVIDENCE" && (
                  <div className={`scan-verdict ${result.verdict.toLowerCase()}`}>
                    <ScannerArtwork kind="verdict" label={result.verdict} />
                    <div>
                      <strong>
                        {result.verdict === "PASS"
                          ? t(copy.consistentWithTheLabel, copy.urdu481)
                          : t(copy.needsACloserLook, copy.urdu482)}
                      </strong>
                      {result.flags.map((flag, i) => (
                        <p key={flag.code + i}>{flag.message}</p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="scan-actions">
                  {onMeasure && (
                    <button className="button" onClick={onMeasure}>
                      <Ruler size={20} aria-hidden="true" />
                      {t("Measure yarn count", "یارن کاؤنٹ ناپیں")}
                    </button>
                  )}
                  <button className="button" onClick={download}>
                    <Download size={20} aria-hidden="true" />
                    {t("Download result", "نتیجہ ڈاؤن لوڈ کریں")}
                  </button>
                </div>
                <details className="scan-details">
                  <summary>{t("Details", "تفصیل")}</summary>
                  {surface && (
                    <figure className="scan-seen">
                      <img src={surface.url} alt={t("The photo that was analysed", "جس تصویر کا تجزیہ ہوا")} />
                      {result.garment && (
                        <span
                          className="scan-seen-box"
                          style={{
                            left: `${result.garment.box[0] * 100}%`,
                            top: `${result.garment.box[1] * 100}%`,
                            width: `${(result.garment.box[2] - result.garment.box[0]) * 100}%`,
                            height: `${(result.garment.box[3] - result.garment.box[1]) * 100}%`,
                          }}
                        >
                          <b>
                            {labelFor(result.garment.label)}
                            {result.garment.confidence !== null && ` ${pct(result.garment.confidence)}`}
                          </b>
                        </span>
                      )}
                    </figure>
                  )}
                  <dl>
                    {[
                      ["structure", t("Fabric", "کپڑا"), result.structure, labelFor],
                      ["fibre_family", t("Fibre", "ریشہ"), result.fibre_family, fibreName],
                      ...Object.entries(result.custom).map(([name, head]) => [name, taughtLabel("x", name), head, name === "mix" ? mixText : (l: string) => taughtLabel(name, l)] as const),
                    ].map(([name, title, head, nameOf]) => {
                      const options = (head as HeadPrediction | null)?.topk ?? result.candidates[name as string] ?? [];
                      return options.length ? (
                        <div key={name as string}>
                          <dt>{title as string}</dt>
                          <dd>{options.slice(0, 3).map(([l, p]) => `${(nameOf as (l: string) => string)(l)} ${pct(p)}`).join(" · ")}</dd>
                        </div>
                      ) : null;
                    })}
                    {result.timings_ms?.total !== undefined && (
                      <div>
                        <dt>{t("Time", "وقت")}</dt>
                        <dd>
                          {(result.timings_ms.total / 1000).toFixed(2)} s:{" "}
                          {[
                            ["garment_detector", "garment detector (OWLv2)"],
                            ["fabric_model", "fabric model (SigLIP 2)"],
                            ["fibre_model", "fibre model (DINOv2)"],
                            ["taught_model", "taught answers model"],
                            ["label_reader", "label reader"],
                          ]
                            .filter(([k]) => result.timings_ms?.[k] !== undefined)
                            .map(([k, name]) => `${name} ${Math.round(result.timings_ms![k])} ms`)
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{t(copy.captureQuality, copy.urdu494)}</dt>
                      <dd>
                        {t(copy.exposure, copy.urdu495)} {result.capture_quality.exposure || "—"} · {t(copy.framing, copy.urdu496)}{" "}
                        {result.capture_quality.framing || "—"} · {t(copy.sharpnessScore, copy.urdu497)}{" "}
                        {result.capture_quality.blur === null ? "—" : result.capture_quality.blur.toFixed(1)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t(copy.model, copy.urdu498)}</dt>
                      <dd><bdi>{result.model_version}</bdi></dd>
                    </div>
                    <div>
                      <dt>{t(copy.scan, copy.urdu499)}</dt>
                      <dd><bdi>{result.scan_id}</bdi></dd>
                    </div>
                  </dl>
                </details>
              </>
              );
            })() : (
              <div className="scan-empty-results">
                <h3>
                  {scanning
                    ? t(copy.findingTheFinerDetails, copy.urdu502)
                    : t("Your answer appears here", "آپ کا جواب یہاں آئے گا")}
                </h3>
                <p>{t("Garment, fabric, composition and finish, each with how sure the model is.", "لباس، کپڑا، بناوٹ اور فنش، ہر ایک کے ساتھ ماڈل کا یقین۔")}</p>
                <ul className="scan-rows" aria-hidden="true">
                  {([["Garment", Shirt], ["Fabric", Layers], ["Composition", Blend], ["Finish", Paintbrush]] as const).map(([title, Icon]) => (
                    <li key={title}><span className="scan-row-icon"><Icon size={24} /></span><div><span>{title}</span><strong>—</strong></div></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
