import { env } from '@/config/env';

/**
 * `network` and `timeout` mean the server was never reached. Those are the
 * failures the offline queue exists for. `http` means the server answered and
 * said no, so retrying the same request will not help.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isRetryable(): boolean {
    return this.kind !== 'http' || (this.status ?? 0) >= 500;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError('timeout', `Request to ${path} timed out after ${timeoutMs} ms`);
    }
    throw new ApiError('network', `Could not reach ${env.apiUrl}: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiError('http', `${path} returned HTTP ${response.status}`, response.status, body);
  }
  return body as T;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
