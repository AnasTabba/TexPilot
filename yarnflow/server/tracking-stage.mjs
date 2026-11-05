/** Shipment stage from the cached tracking result. Same rules as trackingView in src/tracking.ts: keep the two in step. */
const text = value => typeof value === 'string' ? value.trim() : '';
const timeOf = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Newest first; events without a time sink to the end. */
function sortNewest(events) {
  return [...events].sort((a, b) => {
    if (a.at === null || b.at === null) return a.at === null ? (b.at === null ? 0 : 1) : -1;
    return b.at - a.at;
  });
}

/** The stage one event implies, or null when its wording says nothing usable. */
function stageOfEvent(event, destination) {
  const words = `${event.code} ${event.title}`.toLowerCase();
  const atDestination = !!destination && event.location.toLowerCase() === destination.toLowerCase();
  if (/deliver|empty return/.test(words)) return 'delivered';
  if (/discharg|unload|arriv/.test(words) || (/gate[ _-]?out/.test(words) && atDestination)) return 'arrived';
  if (/transship|in transit|sailing/.test(words)) return 'in_transit';
  if (/load|depart|sailed/.test(words)) return 'departed';
  if (/book|gate[ _-]?in|empty pick/.test(words)) return 'booked';
  return null;
}

/** `normalized` is the object trackUnit returns (events, origin, destination, empty). */
export function stageOf(status, normalized) {
  const data = normalized && typeof normalized === 'object' ? normalized : null;
  const events = sortNewest((Array.isArray(data?.events) ? data.events : []).map(e => ({
    at: timeOf(e?.at), title: text(e?.title), code: text(e?.code), location: text(e?.location),
  })));
  const latest = events[0] ?? null;
  const locations = events.map(e => e.location).filter(Boolean);
  const destination = text(data?.destination) || locations[0] || null;
  if (data?.empty === true) return 'delivered';
  if (latest) return stageOfEvent(latest, destination) ?? 'booked';
  if (status === 'error') return 'error';
  if (status === 'tracked') return 'booked';
  return 'not_checked';
}
