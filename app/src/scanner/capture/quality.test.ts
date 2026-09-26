import { assessCapture } from './quality';

describe('assessCapture (stub)', () => {
  test('passes every capture but says it did not check', async () => {
    const report = await assessCapture({ uri: 'file:///x.jpg', width: 1, height: 1 });
    expect(report.passed).toBe(true);
    expect(report.checked).toBe(false);
    expect(report.metrics).toEqual({ blur: null, exposure: null, framing: null });
  });

  // T2: replace the stub, delete the test above, and start here.
  test.todo('rejects a blurry capture with an operator-facing reason');
  test.todo('rejects an over- or under-exposed capture');
});
