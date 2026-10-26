import { ArrowDownToLine, ArrowRightLeft, Factory, Package, PackageCheck, Trash2, Truck, Undo2, type LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StockStage } from './inventory-client';

// Two mill objects Lucide has no glyph for, drawn in its line style (24 grid, 1.75 stroke).
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A yarn cone on its tube: the Stock icon. */
export function ConeIcon({ size = 24, ...rest }: LucideProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...line} {...rest}>
    <path d="M10.6 2h2.8l.5 3h-3.8z" />
    <path d="M9.4 5h5.2l3.4 13.4c-3.8 1.6-8.2 1.6-12 0z" />
    <path d="M8.6 9.6l6.7-1.9M7.7 13.6l8.6-2.4" />
    <path d="M6.2 20.4c3.7 1.3 7.9 1.3 11.6 0" />
  </svg>;
}

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
