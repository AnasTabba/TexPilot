import { breakpointFor } from './useBreakpoint';

describe('breakpointFor', () => {
  test.each([
    [375, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [1023, 'medium'],
    [1024, 'expanded'],
    [1920, 'expanded'],
  ] as const)('%i px is %s', (width, expected) => {
    expect(breakpointFor(width)).toBe(expected);
  });
});
