// Pure shipment-tracking view model. Never throws: malformed or missing JSON reads as "no data".
export interface Shipment {
  id: string;
  purchase_order_id: string;
  bill_of_lading: string;
  status: 'not_checked' | 'tracked' | 'error';
  last_status_json: string | null;
  last_checked_at: number | null;
  last_error: string | null;
  created_at: number;
  reference?: string;
  supplier_name?: string;
  // Server-computed (GET /api/erp/shipments). Absent or null means "derive on the client".
  stage?: TrackingStage | null;
  eta?: number | null;
  origin?: string | null;
  destination?: string | null;
  vessel?: string | null;
  stage_changed_at?: number | null;
  events?: TrackingEvent[];
}

export interface TrackingContract {
  request: { number: string; type?: string; types?: Record<string, string>; carrier?: string; force?: string };
  response: {
    containers: string; containerNumber?: string; reference: string; events: string;
    event: { time: string; title: string; code?: string; location?: string };
    dataTimestamp?: string; eta?: string; origin?: string; destination?: string; vessel?: string; carrier?: string;
  };
}

export interface TrackingSettings {
  enabled: boolean; baseUrl: string; trackPath: string; contract: TrackingContract | null;
  refreshHours: number; dailyBudget: number; verifiedBy: string | null; verifiedAt: number | null;
}

export interface TrackingStatus {
  configured: boolean; keyConfigured: boolean; keyHint: string | null; provider: string; enabled: boolean;
  refreshHours: number; dailyBudget: number; callsToday: number; contractGaps: string[];
}

export type TrackingStage = 'not_checked' | 'booked' | 'departed' | 'in_transit' | 'arrived' | 'delivered' | 'error';

export interface TrackingEvent { at: number | null; title: string; code: string; location: string }

export interface TrackingData {
  containers: string[];
  events: TrackingEvent[];
  reference: string;
  dataAt: number | null;
  empty: boolean;
  eta: number | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  carrier: string | null;
}

export interface TrackingView {
  stage: TrackingStage;
  progress: number;
  lastEvent: TrackingEvent | null;
  origin: string | null;
  destination: string | null;
  eta: number | null;
  vessel: string | null;
  containers: string[];
  events: TrackingEvent[];
}

const PROGRESS: Record<TrackingStage, number> = { not_checked: 0, error: 0, booked: 0.1, departed: 0.3, in_transit: 0.6, arrived: 0.9, delivered: 1 };

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => text(value) || null;

/** Newest first; events without a time sink to the end. */
function sortNewest(events: TrackingEvent[]) {
  return [...events].sort((a, b) => {
    if (a.at === null || b.at === null) return a.at === null ? (b.at === null ? 0 : 1) : -1;
    return b.at - a.at;
  });
}

/** Tolerant read of an event list: anything that is not an object is skipped. */
function readEvents(list: unknown): TrackingEvent[] {
  if (!Array.isArray(list)) return [];
  const events: TrackingEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    events.push({ at: num(e.at), title: text(e.title), code: text(e.code), location: text(e.location) });
  }
  return sortNewest(events);
}

const isStage = (value: unknown): value is TrackingStage => typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROGRESS, value);

export function parseTrackingData(raw: unknown): TrackingData | null {
  if (typeof raw !== 'string' || !raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  return {
    containers: Array.isArray(o.containers) ? o.containers.map(text).filter(Boolean) : [],
    events: readEvents(o.events),
    reference: text(o.reference),
    dataAt: num(o.dataAt),
    empty: o.empty === true,
    eta: num(o.eta),
    origin: str(o.origin),
    destination: str(o.destination),
    vessel: str(o.vessel),
    carrier: str(o.carrier),
  };
}

/** The stage one event implies, or null when its wording says nothing usable. */
function stageOf(event: TrackingEvent, destination: string | null): TrackingStage | null {
  const words = `${event.code} ${event.title}`.toLowerCase();
  const atDestination = !!destination && event.location.toLowerCase() === destination.toLowerCase();
  if (/deliver|empty return/.test(words)) return 'delivered';
  if (/discharg|unload|arriv/.test(words) || (/gate[ _-]?out/.test(words) && atDestination)) return 'arrived';
  if (/transship|in transit|sailing/.test(words)) return 'in_transit';
  if (/load|depart|sailed/.test(words)) return 'departed';
  if (/book|gate[ _-]?in|empty pick/.test(words)) return 'booked';
  return null;
}

/** Server values win when present; the stage is derived on the client only when the server sends none. */
export function trackingView(shipment: Pick<Shipment, 'status' | 'last_status_json' | 'last_error'> & Partial<Shipment>): TrackingView {
  const data = parseTrackingData(shipment.last_status_json);
  const events = shipment.events !== undefined ? readEvents(shipment.events) : data?.events ?? [];
  const latest = events[0] ?? null;
  const locations = events.map(e => e.location).filter(Boolean);
  const origin = str(shipment.origin) ?? data?.origin ?? locations[locations.length - 1] ?? null;
  const destination = str(shipment.destination) ?? data?.destination ?? locations[0] ?? null;

  let derived: TrackingStage;
  if (data?.empty) derived = 'delivered';
  else if (latest) derived = stageOf(latest, destination) ?? 'booked';
  else if (shipment.status === 'error') derived = 'error';
  else if (shipment.status === 'tracked') derived = 'booked';
  else derived = 'not_checked';
  const stage = isStage(shipment.stage) ? shipment.stage : derived;

  return { stage, progress: PROGRESS[stage], lastEvent: latest, origin, destination, eta: num(shipment.eta) ?? data?.eta ?? null, vessel: str(shipment.vessel) ?? data?.vessel ?? null, containers: data?.containers ?? [], events };
}
