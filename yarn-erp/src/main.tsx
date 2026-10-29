import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/figtree";
// The true italic face for elegant display headings (no synthetic slant).
import "@fontsource-variable/figtree/wght-italic.css";
import LiveApp from "./LiveApp";
import SupplierPortal from './SupplierPortal';
import BuyerPortal from './BuyerPortal';
import { useEffect, useState } from 'react';
import { LanguageProvider } from "./i18n";
import "./yarnflow.css";
import { applyStoredTheme } from "./AppSettings";
import { applyStoredWallpaper } from "./wallpaper-store";
applyStoredTheme();
applyStoredWallpaper();
// crypto.randomUUID exists only on HTTPS and localhost; phones testing over the LAN use plain
// HTTP. getRandomValues works everywhere, so build the same random v4 UUID from it.
if (typeof crypto.randomUUID !== "function")
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    ) as ReturnType<Crypto["randomUUID"]>;
// '#/buyer' or '#/buyer/…' opens the external buyer portal; the staff '#/buyers' section must stay in the staff app.
const portalRoute = () => location.hash.startsWith('#/supplier') ? 'supplier' : /^#\/buyer(\/|$)/.test(location.hash) ? 'buyer' : 'staff';
function Application() {
  const [route, setRoute] = useState(portalRoute);
  useEffect(() => { const update = () => { setRoute(portalRoute()); }; addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return route === 'supplier' ? <SupplierPortal /> : route === 'buyer' ? <BuyerPortal /> : <LiveApp />;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider><Application /></LanguageProvider>
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
