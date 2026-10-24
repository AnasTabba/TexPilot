import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedEntries,
  total,
  balance,
  appendEntry,
  createEntry,
  kgToGrams,
  reverseEntry,
  today,
} from "../src/domain.ts";
const production = (lot = "1221", grams = 100000, cartons = 4, cones = 96) =>
  createEntry({
    kind: "production",
    lot,
    grams,
    cartons,
    cones,
    machine: "1A",
    notes: "",
    shift: "A",
    date: today(),
  });
test("A03 — stores exact integer grams; blocks zero, negative, ambiguous and overprecision weights", () => {
  assert.equal(kgToGrams("258.660"), 258660);
  assert.equal(kgToGrams("0.001"), 1);
  for (const value of ["0", "-2", "258,660", "1.0001", "NaN", "Infinity"])
    assert.throws(() => kgToGrams(value));
});
test("B01 — dispatch beyond available stock never enters the ledger", () => {
  const seed = seedEntries();
  const e = createEntry({
    kind: "dispatch",
    lot: "1221",
    grams: 99999999,
    cartons: 4,
    cones: 96,
    machine: "Lahore Knitwear",
    notes: "",
    shift: "A",
    date: today(),
  });
  assert.throws(() => appendEntry(seed, e), /stock/);
  assert.equal(seed.length, 16);
});
test("B03 — QC hold prevents dispatch even when stock is available", () => {
  assert.throws(
    () =>
      createEntry({
        kind: "dispatch",
        lot: "1216",
        grams: 1000,
        cartons: 1,
        cones: 24,
        machine: "customer",
        notes: "",
        shift: "A",
        date: today(),
      }),
    /hold/,
  );
});
test("D02 — retry with the same client ID is idempotent", () => {
  const seed = seedEntries();
  const e = production();
  const once = appendEntry(seed, e);
  const twice = appendEntry(once, e);
  assert.equal(once.length, twice.length);
  assert.deepEqual(total(once, "finished"), total(twice, "finished"));
});
test("B06 — reversal restores stock and preserves original history", () => {
  const seed = seedEntries();
  const e = createEntry({
    kind: "dispatch",
    lot: "1221",
    grams: 100000,
    cartons: 4,
    cones: 96,
    machine: "customer",
    notes: "",
    shift: "A",
    date: today(),
  });
  const next = appendEntry(seed, e);
  const reversed = reverseEntry(next, e, "Wrong lot");
  assert.deepEqual(total(reversed, "finished"), total(seed, "finished"));
  assert.ok(reversed.includes(e));
  assert.equal(reversed.at(-1)?.reverses, e.id);
  assert.throws(() => reverseEntry(reversed, e, "again"), /reversed/);
});
test("B05 — dependent stock usage blocks reversing a receipt", () => {
  const entries = seedEntries();
  const e = production("1221", 100000, 4, 96);
  const list = appendEntry(entries, e);
  const b = balance(list, "1221", "finished");
  const dispatched = createEntry({
    kind: "dispatch",
    lot: "1221",
    grams: b.grams,
    cartons: b.cartons,
    cones: b.cones,
    machine: "customer",
    notes: "",
    shift: "A",
    date: today(),
  });
  assert.throws(
    () => reverseEntry(appendEntry(list, dispatched), e, "Wrong production"),
    /stock/,
  );
});
test("C05 — blocks future business dates", () => {
  assert.throws(
    () =>
      createEntry({
        kind: "production",
        lot: "1221",
        grams: 1000,
        cartons: 1,
        cones: 24,
        machine: "1A",
        notes: "",
        shift: "A",
        date: "2099-01-01",
      }),
    /future/,
  );
});
test("Ledger invariant — 100 additions and reversals reconcile to the exact initial balance", () => {
  let entries = seedEntries();
  const initial = total(entries, "finished");
  for (let i = 1; i <= 100; i++) {
    const entry = production("1221", i * 1237, i, i * 24);
    entries = appendEntry(entries, entry);
    entries = reverseEntry(entries, entry, "Property sequence");
  }
  assert.deepEqual(total(entries, "finished"), initial);
  assert.equal(total(entries, "finished").grams, 12480000);
});
test("Issue transfers the same integer quantities between raw stock and machine WIP", () => {
  const seed = seedEntries();
  const before = total(seed, "raw");
  const e = createEntry({
    kind: "issue",
    lot: "1221",
    grams: 123456,
    cartons: 5,
    cones: 120,
    machine: "1A",
    notes: "",
    shift: "A",
    date: today(),
  });
  const next = appendEntry(seed, e);
  assert.equal(total(next, "raw").grams, before.grams - 123456);
  assert.equal(total(next, "wip").grams, 123456);
});
