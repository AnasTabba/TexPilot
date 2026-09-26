import { useWindowDimensions } from 'react-native';

import { breakpoints } from '@/theme';

/** compact: phones · medium: tablets, small windows · expanded: laptops and up. */
export type Breakpoint = 'compact' | 'medium' | 'expanded';

export function breakpointFor(width: number): Breakpoint {
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

/** Re-renders when the window crosses a breakpoint (rotation, browser resize). */
export function useBreakpoint(): Breakpoint {
  return breakpointFor(useWindowDimensions().width);
}
