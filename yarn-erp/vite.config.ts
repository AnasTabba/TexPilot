import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { proxy: {
  // TexPilot's scanner API first (it alone uses /api/v1), so the app reaches the model at its
  // own address and needs no cross-origin call; everything else under /api is the inventory API.
  '/api/v1': process.env.TEXPILOT_API_URL || 'http://127.0.0.1:8000',
  // Keep the browser's Host: the inventory API only saves when Origin matches its own URL,
  // and the string shorthand would rewrite Host to 127.0.0.1:8788 (every save -> 403).
  '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false },
} } });
