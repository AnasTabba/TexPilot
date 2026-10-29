import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/noto-nastaliq-urdu/arabic-400.css";
import LiveApp from "./LiveApp";
import AccessGate from "./LoginPage";
// The practice register (/?practice=1) loads only when asked for: the shared app opens faster.
const App = lazy(() => import("./App"));
import "./styles.css";
import "./workspace.css";
import "./live.css";
import "./theme.css";
import "./approved.css";
// crypto.randomUUID exists only on HTTPS and localhost; phones testing over the LAN use plain
// HTTP. getRandomValues works everywhere, so build the same random v4 UUID from it.
if (typeof crypto.randomUUID !== "function")
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    ) as ReturnType<Crypto["randomUUID"]>;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get('practice') === '1' ? <Suspense fallback={null}><App /></Suspense> : <AccessGate><LiveApp /></AccessGate>}
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );

import "./reference-dashboard.css";
import "./mvp.css";
