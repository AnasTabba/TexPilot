import { ArrowDownToLine, ArrowRightLeft, Factory, Package, PackageCheck, Trash2, Truck, Undo2, type LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StockStage } from './inventory-client';

// A mill object Lucide has no glyph for, drawn in its line style (24 grid, 1.75 stroke).
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A cop: ring-frame yarn on its bobbin, the last stock stage. */
export function CopIcon({ size = 24, ...rest }: LucideProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...line} {...rest}>
    <path d="M12 1.5v21" />
    <path d="M7.5 8.5 10.5 4h3l3 4.5" />
    <path d="M7.5 8.5h9l1.5 9c0 2.6-12 2.6-12 0z" />
    <path d="M7 12.5h10M6.5 16h11" />
  </svg>;
}

export const stageIcon: Record<StockStage, (props: LucideProps) => ReactNode> = {
  raw: Package, wip: Factory, finished: PackageCheck, cops: CopIcon,
};
export const moveIcon: Record<string, (props: LucideProps) => ReactNode> = {
  receive: ArrowDownToLine, transfer: ArrowRightLeft, dispatch: Truck, waste: Trash2, reverse: Undo2,
};
