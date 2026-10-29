import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingView } from '../src/tracking.ts';

type Ev = { at: number | null; title: string; code: string; location: string };
const json = (value: unknown) => JSON.stringify(value);
const shipment = (data: unknown, status: 'not_checked' | 'tracked' | 'error' = 'tracked') => ({ status, last_status_json: typeof data === 'string' ? data : json(data), last_error: null });
const ev = (title: string, at: number, location = 'Karachi', code = ''): Ev => ({ at, title, code, location });
const stageOf = (events: Ev[], extra: Record<string, unknown> = {}) => trackingView(shipment({ containers: [], events, reference: 'BL1', dataAt: null, empty: false, eta: null, origin: null, destination: null, vessel: null, carrier: null, ...extra })).stage;

test('latest event drives each stage', () => {
  assert.equal(stageOf([ev('Booking confirmed', 1)]), 'booked');
  assert.equal(stageOf([ev('Gate in at origin', 1)]), 'booked');
  assert.equal(stageOf([ev('Empty pick-up', 1)]), 'booked');
  assert.equal(stageOf([ev('Loaded on vessel', 2)]), 'departed');
  assert.equal(stageOf([ev('Vessel sailed', 2)]), 'departed');
  assert.equal(stageOf([ev('Vessel sailing', 2)]), 'in_transit');
  assert.equal(stageOf([ev('Transshipped at hub', 2)]), 'in_transit');
  assert.equal(stageOf([ev('Cargo in transit', 2)]), 'in_transit');
  assert.equal(stageOf([ev('Discharged at port', 3)]), 'arrived');
  assert.equal(stageOf([ev('Delivered to consignee', 4)]), 'delivered');
  assert.equal(stageOf([ev('Empty return completed', 4)]), 'delivered');
});

test('the newest event wins, not the first in the array', () => {
  assert.equal(stageOf([ev('Discharged', 5), ev('Loaded', 1)]), 'arrived');
  assert.equal(stageOf([ev('Loaded', 1), ev('Sailing', 3), ev('Booked', 0)]), 'in_transit');
});

test('gate out counts as arrived only at the destination', () => {
  assert.equal(stageOf([ev('Gate out', 2, 'Rotterdam')], { destination: 'Rotterdam' }), 'arrived');
  assert.equal(stageOf([ev('Gate out', 2, 'Karachi')], { destination: 'Rotterdam' }), 'booked');
});

test('empty flag means delivered even without a matching event', () => {
  assert.equal(stageOf([ev('Unknown', 1)], { empty: true }), 'delivered');
  assert.equal(trackingView(shipment({ containers: [], events: [], empty: true })).stage, 'delivered');
});

test('tracked with no events is booked; error with no data is error', () => {
  assert.equal(trackingView(shipment({ containers: [], events: [] })).stage, 'booked');
  assert.equal(trackingView({ status: 'tracked', last_status_json: null, last_error: null }).stage, 'booked');
  assert.equal(trackingView({ status: 'error', last_status_json: null, last_error: 'down' }).stage, 'error');
  assert.equal(trackingView({ status: 'error', last_status_json: 'not json', last_error: 'down' }).stage, 'error');
  assert.equal(trackingView({ status: 'not_checked', last_status_json: null, last_error: null }).stage, 'not_checked');
});

test('progress follows the stage', () => {
  assert.equal(trackingView({ status: 'not_checked', last_status_json: null, last_error: null }).progress, 0);
  assert.equal(trackingView(shipment({ events: [ev('Booked', 1)] })).progress, 0.1);
  assert.equal(trackingView(shipment({ events: [ev('Loaded', 1)] })).progress, 0.3);
  assert.equal(trackingView(shipment({ events: [ev('Sailing', 1)] })).progress, 0.6);
  assert.equal(trackingView(shipment({ events: [ev('Discharged', 1)] })).progress, 0.9);
  assert.equal(trackingView(shipment({ events: [ev('Delivered', 1)] })).progress, 1);
});

test('origin and destination fall back to first and last event locations', () => {
  const view = trackingView(shipment({ events: [ev('Sailing', 3, 'Rotterdam'), ev('Loaded', 2, 'Karachi'), ev('Gate in', 1, 'Karachi')] }));
  assert.equal(view.origin, 'Karachi');
  assert.equal(view.destination, 'Rotterdam');
  assert.equal(view.lastEvent?.title, 'Sailing');
});

test('explicit origin, destination, eta, vessel and containers are passed through', () => {
  const view = trackingView(shipment({ containers: ['MSCU1', 'MSCU2'], events: [], origin: 'PKKHI', destination: 'NLRTM', eta: 1700000000000, vessel: 'MSC Anna', carrier: 'MSC' }));
  assert.deepEqual([view.origin, view.destination, view.eta, view.vessel, view.containers], ['PKKHI', 'NLRTM', 1700000000000, 'MSC Anna', ['MSCU1', 'MSCU2']]);
});

test('events are sorted newest first with untimed events last', () => {
  const view = trackingView(shipment({ events: [ev('A', null), ev('B', 1), ev('C', 9)] }));
  assert.deepEqual(view.events.map(e => e.title), ['C', 'B', 'A']);
});

test('malformed or odd JSON never throws', () => {
  const cases: (string | null)[] = [null, '', 'not json', '[]', '42', 'null', '{"events":"oops"}', '{"events":[null,5,"x"]}', json({ events: [{ at: 'soon', title: 7 }] })];
  for (const raw of cases) {
    const view = trackingView({ status: 'tracked', last_status_json: raw, last_error: null });
    assert.equal(typeof view.stage, 'string');
    assert.ok(Array.isArray(view.events));
  }
  assert.equal(trackingView({ status: 'tracked', last_status_json: '{"events":[null,5]}', last_error: null }).events.length, 0);
  assert.equal(trackingView({ status: 'tracked', last_status_json: json({ events: [{ at: 'soon', title: 7 }] }), last_error: null }).lastEvent?.title, '');
});
