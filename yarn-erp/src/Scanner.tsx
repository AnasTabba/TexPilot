import { copy } from "./ui-copy";
import { Fragment, useEffect, useRef, useState } from "react";
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
import FabricHero, { artwork, type Art } from "./FabricHero";
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
            : t(copy.notEnoughEvidence, copy.urdu431)}
        </strong>
        {!head && near && near.length > 0 && (
          <small className="scan-candidates">
            {t(copy.closestNotConfident, copy.closestNotConfidentUr)}{" "}
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
          <bdi>
            {Math.round(head.confidence * 100)}
            {copy.urdu432}
          </bdi>
          <span>
            <i style={{ width: head.confidence * 100 + "%" }} />
          </span>
        </div>
      ) : (
        <span className="scan-abstain">{copy.urdu433}</span>
      )}
    </div>
  );
  const art: Art | null = !result
    ? null
    : ["denim", "chambray"].includes(result.structure?.label ?? "")
      ? "denim"
      : (result.fibre_family?.label ?? result.candidates.fibre_family?.[0]?.[0]) === "synthetic"
        ? "polyester"
        : "cotton";
  return (
    <div className="scanner-page">
      <FabricHero
        t={t}
        busy={openingCamera || scanning}
        onScan={() => {
          document.querySelector(".scan-capture-panel")?.scrollIntoView({ behavior: "smooth" });
          void openCamera();
        }}
      />
      <div className="scan-topline">
        <span className="scan-model-badge">
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
          className="button scan-connection-button"
          disabled={scanning}
          onClick={() => setConfigOpen(!configOpen)}
        >
          <Settings2 size={16} />
          {t(copy.modelConnection, copy.urdu438)}
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
      <div className="scanner-grid">
        <section className="scan-capture-panel panel">
          <div className="panel-heading">
            <div>
              <h2>{t(copy.aCloserLookAtYourMaterial, copy.urdu444)}</h2>
              <p>{t(copy.captureTheFabricOrGarmentInGood, copy.urdu445)}</p>
            </div>
            <span className="scan-step-count">
              <bdi>{slot === "surface" ? "01" : "02"}</bdi>
              {copy.label022}
            </span>
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
                {activePhoto && (
                  <button
                    className="icon-button"
                    aria-label={t(copy.removeSelectedPhoto, copy.urdu470)}
                    disabled={scanning}
                    onClick={removePhoto}
                  >
                    <X size={18} />
                    <span className="control-label">
                      {t(copy.removeSelectedPhoto, copy.urdu470)}
                    </span>
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
                  {activePhoto.file.name}
                  {copy.urdu21}{" "}
                  {(activePhoto.file.size / 1024 / 1024).toFixed(1)}
                  {copy.mb}
                </bdi>
              ) : (
                t(copy.jpegPngOrWebpUpTo10, copy.jpegPngWebp)
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
                {t(copy.addCareLabel, copy.urdu471)}
                <ArrowRight size={13} />
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
            <span>
              <ShieldCheck size={16} />
              {t(copy.realModelResultsNoSimulatedPredictions, copy.urdu475)}
            </span>
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
            {result ? (
              <>
                {art && (
                  <div className={`scan-guide-art fabric-hero-${art}`}>
                    <span className="fabric-hero-circle" aria-hidden="true" />
                    <img src={artwork[art]} alt="" />
                    {result.structure && (
                      <span className="scan-guide-pill">
                        {labelFor(result.structure.label).toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
                <div className="scan-answer">
                  <span>{t("Fabric", "کپڑا")}</span>
                  <h3 className={result.structure ? "is-label" : ""}>
                    {result.structure
                      ? labelFor(result.structure.label)
                      : t("Not sure which fabric yet", "ابھی پکا نہیں کہ کون سا کپڑا ہے")}
                  </h3>
                  <span>{t("Made of", "کس چیز سے بنا")}</span>
                  <strong>
                    {result.stated_composition.fibers.length
                      ? result.stated_composition.fibers
                          .map((f) => `${f.pct}% ${labelFor(f.name)}`)
                          .join(" / ") + t(" (from the label)", " (لیبل سے)")
                      : result.fibre_family
                        ? {
                            cellulosic: t("Plant fibre: cotton, linen or viscose", "پودوں کا ریشہ: کاٹن، لینن یا وسکوز"),
                            synthetic: t("Synthetic: polyester, nylon or acrylic", "مصنوعی: پولیسٹر، نائلون یا ایکریلک"),
                            protein: t("Animal fibre: wool or silk", "جانوروں کا ریشہ: اون یا ریشم"),
                          }[result.fibre_family.label] ?? labelFor(result.fibre_family.label)
                        : t("Not sure from the photo", "تصویر سے پکا نہیں")}
                  </strong>
                  <span>{t("Yarn to buy", "کون سا یارن خریدیں")}</span>
                  {result.yarn_advice?.length ? (
                    <ul>
                      {result.yarn_advice.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {t(
                        "Get closer so the weave fills the frame, then scan again.",
                        "قریب سے تصویر لیں تاکہ بُنائی پوری نظر آئے، پھر دوبارہ اسکین کریں۔",
                      )}
                    </p>
                  )}
                  <div className="scan-next">
                    {!result.stated_composition.fibers.length && (
                      <button
                        className="button"
                        onClick={() => {
                          setSlot("label");
                          document.querySelector(".scan-capture-panel")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        <Tag size={17} />
                        {t("Exact mix: add the care-label photo", "اصل مکس: کیئر لیبل کی تصویر لگائیں")}
                      </button>
                    )}
                    {onMeasure && (
                      <button className="button primary" onClick={onMeasure}>
                        <ArrowRight size={17} />
                        {t("Exact count: measure with the card", "اصل کاؤنٹ: کارڈ سے ناپیں")}
                      </button>
                    )}
                  </div>
                </div>
                {result.verdict !== "INSUFFICIENT_EVIDENCE" && (
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
                        ? t(copy.consistentWithTheLabel, copy.urdu481)
                        : result.verdict === "FLAG"
                          ? t(copy.needsACloserLook, copy.urdu482)
                          : t(copy.moreEvidenceNeeded, copy.urdu483)}
                    </strong>
                    <p>
                      {result.verdict === "PASS"
                        ? t(
                            copy.noInconsistencyWasFlaggedByTheModel,
                            copy.urdu484,
                          )
                        : result.verdict === "FLAG"
                          ? t(
                              copy.reviewTheFlaggedEvidenceBeforeAcceptingThis,
                              copy.urdu485,
                            )
                          : t(copy.tryAClearerPhotoAndAddThe, copy.urdu486)}
                    </p>
                  </div>
                </div>
                )}
                <div className="scan-predictions">
                  {headRow(
                    copy.fabricStructure,
                    copy.urdu487,
                    result.structure,
                    Layers3,
                    result.candidates.structure,
                  )}
                  {headRow(
                    copy.surfaceTreatment,
                    copy.urdu488,
                    result.treatment,
                    Sun,
                    result.candidates.treatment,
                  )}
                  {headRow(
                    copy.fibreFamily,
                    copy.urdu489,
                    result.fibre_family,
                    Tag,
                    result.candidates.fibre_family,
                  )}
                  {Object.entries(result.custom).map(([name, head]) => {
                    const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");
                    return (
                      <Fragment key={name}>
                        {headRow(title, title, head, Tag, result.candidates[name])}
                      </Fragment>
                    );
                  })}
                </div>
                {result.garment && (
                  <div className="scan-garment">
                    <span>{t(copy.garmentDetected, copy.urdu490)}</span>
                    <strong>{labelFor(result.garment.label)}</strong>
                    {result.garment.confidence !== null && (
                      <bdi>
                        {Math.round(result.garment.confidence * 100)}
                        {copy.urdu432}
                      </bdi>
                    )}
                  </div>
                )}
                <div className="scan-composition">
                  <h3>
                    {t(copy.compositionFromTheLabel, copy.urdu491)}
                  </h3>
                  {result.stated_composition.fibers.length ? (
                    <div>
                      {result.stated_composition.fibers.map((fiber, i) => (
                        <span key={fiber.name + i}>
                          <bdi>
                            {fiber.pct}
                            {copy.urdu432}
                          </bdi>{" "}
                          {labelFor(fiber.name)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p>{t(copy.noCompositionWasReadAddALabel, copy.urdu492)}</p>
                  )}
                </div>
                {result.flags.length > 0 && (
                  <div className="scan-flags">
                    <h3>{t(copy.thingsToReview, copy.urdu493)}</h3>
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
                  <h3>{t(copy.captureQuality, copy.urdu494)}</h3>
                  <div>
                    <span>
                      {t(copy.exposure, copy.urdu495)}
                      <strong>{result.capture_quality.exposure || "—"}</strong>
                    </span>
                    <span>
                      {t(copy.framing, copy.urdu496)}
                      <strong>{result.capture_quality.framing || "—"}</strong>
                    </span>
                    <span>
                      {t(copy.sharpnessScore, copy.urdu497)}
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
                    {t(copy.model, copy.urdu498)}
                    {copy.urdu49}
                    <bdi>{result.model_version}</bdi>
                  </span>
                  <span>
                    {t(copy.scan, copy.urdu499)}
                    {copy.urdu49}
                    <bdi>{result.scan_id}</bdi>
                  </span>
                  <span>
                    {t(copy.scanned, copy.urdu500)}
                    {copy.urdu49}{" "}
                    <bdi>
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: copy.asiaKarachi,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(result.timestamp))}
                    </bdi>
                  </span>
                </div>
                <div className="scan-result-actions">
                  <button className="button" onClick={download}>
                    <Download size={16} />
                    {t(copy.saveResult, copy.urdu501)}
                  </button>
                  <button className="text-button" onClick={onInventory}>
                    {t(copy.openInventory, copy.urdu99)}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <div className="scan-empty-results">
                <h3>
                  {scanning
                    ? t(copy.findingTheFinerDetails, copy.urdu502)
                    : t(copy.aLittleClarityStartsHere, copy.urdu503)}
                </h3>
                <p>
                  {t(
                    copy.yourMaterialSStructureSurfaceTreatmentAnd,
                    copy.urdu504,
                  )}
                </p>
                <div className="scan-result-placeholders">
                  {[
                    [Layers3, copy.fabricStructure, copy.urdu487],
                    [Sun, copy.surfaceTreatment, copy.urdu488],
                    [Tag, copy.fibreFamily, copy.urdu489],
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
          <section className="scan-tip-card">
            <span>
              <Focus size={19} />
            </span>
            <div>
              <h3>{t(copy.goodLightMakesTheDifference, copy.urdu505)}</h3>
              <p>{t(copy.brightEvenLightFabricFillsPhoto, copy.brightEvenLightFabricFillsPhotoUr)}</p>
            </div>
          </section>
          <p className="scan-evidence-note">
            <ShieldCheck size={15} />
            {t(copy.visualEvidenceHelpsVerifyMaterialExactFibre, copy.urdu507)}
          </p>
        </aside>
      </div>
    </div>
  );
}
