/**
 * Configuration the host passes in. The scanner never reads the app's env or
 * settings itself; that is what keeps it embeddable (see README.md here).
 */

export interface ScannerConfig {
  /** Base URL of the TexPilot API, e.g. "https://api.example.com". */
  apiUrl: string;
}

let current: ScannerConfig | null = null;

/** Call once at startup, and again whenever the host's settings change. */
export function configureScanner(config: ScannerConfig): void {
  current = { ...config, apiUrl: config.apiUrl.replace(/\/+$/, '') };
}

export function getScannerConfig(): ScannerConfig {
  if (!current) {
    // No default URL: silently talking to the wrong server is worse than failing.
    throw new Error('configureScanner() must be called before the scanner is used.');
  }
  return current;
}
