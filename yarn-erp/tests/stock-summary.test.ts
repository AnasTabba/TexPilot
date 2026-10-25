import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockHistory, availableForDispatch } from '../src/stock-summary.ts';
test('dispatch availability counts approved stock only', () => {
  assert.equal(availableForDispatch([{id:'a',quality:'approved'},{id:'b',quality:'hold'}], [{lot_id:'a',grams:1200},{lot_id:'b',grams:9000}]),1200);
});
test('empty movement history never invents a trend', () => { assert.deepEqual(stockHistory([],5000),[]); });
test('stock history uses net external changes and leaves transfers neutral', () => {
  const records = [{created_at:1000,from_stage:null,to_stage:'raw',grams:5000},{created_at:2000,from_stage:'raw',to_stage:'wip',grams:2000},{created_at:3000,from_stage:'wip',to_stage:null,grams:1000}];
  assert.deepEqual(stockHistory(records,4000).map(p=>p.grams),[5000,5000,4000]);
});
