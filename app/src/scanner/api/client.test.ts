import { configureScanner } from '../config';
import { ApiError, request } from './client';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function respond(status: number, body: string) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
}

beforeAll(() => configureScanner({ apiUrl: 'http://api.test' }));
beforeEach(() => fetchMock.mockReset());

describe('request', () => {
  test('parses a JSON body from the configured server', async () => {
    respond(200, '{"status":"ok"}');
    await expect(request('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/health');
  });

  test('an unreachable server is a retryable network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await request('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('network');
    expect((err as ApiError).isRetryable).toBe(true);
  });

  test('a 422 is an http error that must not be retried', async () => {
    respond(422, '{"detail":[]}');
    const err = (await request('/api/v1/scan').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('http');
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ detail: [] });
    expect(err.isRetryable).toBe(false);
  });

  test('a 5xx is retryable', async () => {
    respond(503, '');
    const err = (await request('/api/v1/scan').catch((e: unknown) => e)) as ApiError;
    expect(err.isRetryable).toBe(true);
  });
});
