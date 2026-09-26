import { configureScanner, getScannerConfig } from './config';

describe('scanner config', () => {
  test('refuses to run unconfigured rather than guess a server', () => {
    expect(() => getScannerConfig()).toThrow(/configureScanner/);
  });

  test('normalises a trailing slash on the API URL', () => {
    configureScanner({ apiUrl: 'http://192.168.1.23:8000/' });
    expect(getScannerConfig().apiUrl).toBe('http://192.168.1.23:8000');
  });
});
