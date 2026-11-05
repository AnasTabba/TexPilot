// Pure time-range helpers shared by the dashboard widgets. No React imports, so node's test runner can load this file.

export type Range = '14d' | '30d' | '6m' | '1y' | 'all';
export type Bucket = { start: number; end: number; label: string };

export const RANGES: { value: Range; en: string; ur: string }[] = [
  { value: '14d', en: '14 days', ur: '14 دن' },
  { value: '30d', en: '30 days', ur: '30 دن' },
  { value: '6m', en: '6 months', ur: '6 ماہ' },
  { value: '1y', en: '1 year', ur: '1 سال' },
  { value: 'all', en: 'All time', ur: 'سب' },
];

const DAY = 86_400_000;
const KARACHI_OFFSET = 5 * 3_600_000; // Asia/Karachi is fixed UTC+5 with no DST.
const MAX_MONTHS = 60;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function civil(time: number) {
  const d = new Date(time + KARACHI_OFFSET);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}
const dayStart = (time: number) => Math.floor((time + KARACHI_OFFSET) / DAY) * DAY - KARACHI_OFFSET;
/** Start of a month, given the month index year * 12 + month. */
const monthStart = (index: number) => Date.UTC(Math.floor(index / 12), index % 12, 1) - KARACHI_OFFSET;

/**
 * Contiguous buckets in Karachi time. The last bucket always contains `now`.
 * 14d/30d: daily. 6m: 26 weekly. 1y: last 12 months. all: months from `firstTime`'s month
 * (last 12 months if there is no data), capped at the most recent 60 months.
 */
export function buckets(range: Range, now: number, firstTime?: number): Bucket[] {
  const today = dayStart(now);
  if (range === '14d' || range === '30d') {
    const count = range === '14d' ? 14 : 30;
    return Array.from({ length: count }, (_, i) => {
      const start = today - (count - 1 - i) * DAY;
      return { start, end: start + DAY, label: String(civil(start).day) };
    });
  }
  if (range === '6m') {
    // Last week runs from today - 6 days to tomorrow, so the 26 weeks cover 182 days.
    return Array.from({ length: 26 }, (_, i) => {
      const start = today - 6 * DAY - (25 - i) * 7 * DAY;
      const { day, month } = civil(start);
      return { start, end: start + 7 * DAY, label: `${day} ${MONTHS[month]}` };
    });
  }
  const nowCivil = civil(now);
  const last = nowCivil.year * 12 + nowCivil.month;
  let first = last - 11;
  if (range === 'all' && firstTime !== undefined) {
    const firstCivil = civil(firstTime);
    first = Math.min(firstCivil.year * 12 + firstCivil.month, last);
  }
  first = Math.max(first, last - (MAX_MONTHS - 1));
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const index = first + i;
    const month = index % 12;
    const year = Math.floor(index / 12) % 100;
    const label = i === 0 || month === 0 ? `${MONTHS[month]} ${String(year).padStart(2, '0')}` : MONTHS[month];
    return { start: monthStart(index), end: monthStart(index + 1), label };
  });
}

/** Index of the bucket containing `time`, or -1 when it falls outside all buckets. */
export const bucketIndex = (list: Bucket[], time: number) => list.findIndex(b => time >= b.start && time < b.end);
