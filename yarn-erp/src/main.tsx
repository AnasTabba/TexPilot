import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/figtree";
// The true italic face for elegant display headings (no synthetic slant).
import "@fontsource-variable/figtree/wght-italic.css";
import LiveApp from "./LiveApp";
import { LanguageProvider } from "./i18n";
import "./yarnflow.css";
// crypto.randomUUID exists only on HTTPS and localhost; phones testing over the LAN use plain
// HTTP. getRandomValues works everywhere, so build the same random v4 UUID from it.
if (typeof crypto.randomUUID !== "function")
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    ) as ReturnType<Crypto["randomUUID"]>;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider><LiveApp /></LanguageProvider>
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
