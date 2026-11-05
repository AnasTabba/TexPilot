import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALLPAPERS, DEFAULT_WALLPAPER, readWallpaper, saveWallpaper,
  wallpaperImage, applyWallpaper, applyStoredWallpaper,
} from '../src/wallpaper-store.ts';

const key = 'yarnflow-wallpaper';
let values: Map<string, string>;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
});
afterEach(() => {
  for (const [name, descriptor] of [['localStorage', storageDescriptor], ['document', documentDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('empty storage returns defaults', () => {
  assert.deepEqual(readWallpaper(), { id: 'none', dim: 0.2 });
});

test('invalid JSON, shapes and unknown IDs return defaults', () => {
  for (const raw of ['garbage', 'null', '[]', '42', '"dusk"', '{}', '{"id":"unknown","dim":0.5}']) {
    values.set(key, raw);
    assert.deepEqual(readWallpaper(), DEFAULT_WALLPAPER);
  }
});

test('dim is clamped and invalid or missing dim uses default', () => {
  for (const [dim, expected] of [[-1, 0], [2, 0.7], [0.35, 0.35], ['0.5', 0.2], [null, 0.2], [undefined, 0.2]] as const) {
    values.set(key, JSON.stringify({ id: 'dusk', dim }));
    assert.deepEqual(readWallpaper(), { id: 'dusk', dim: expected });
  }
  values.set(key, '{"id":"dusk","dim":1e400}');
  assert.equal(readWallpaper().dim, 0.2);
});

test('custom requires an image data URL', () => {
  for (const custom of [undefined, null, 12, '', 'https://example.com/image.jpg', 'data:text/plain,hello']) {
    values.set(key, JSON.stringify({ id: 'custom', dim: 0.4, custom }));
    assert.deepEqual(readWallpaper(), DEFAULT_WALLPAPER);
  }
});

test('preferences round trip including a retained custom photo', () => {
  for (const id of ['custom', 'garden', 'none'] as const) {
    const prefs = { id, dim: 0.4, custom: 'data:image/jpeg;base64,abc' };
    assert.equal(saveWallpaper(prefs), true);
    assert.deepEqual(readWallpaper(), prefs);
  }
});

test('storage failures return false on save and defaults on read', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('quota'); },
    },
  });
  assert.equal(saveWallpaper(DEFAULT_WALLPAPER), false);
  assert.deepEqual(readWallpaper(), DEFAULT_WALLPAPER);
});

test('image lookup covers none, all six ordered presets and custom', () => {
  assert.deepEqual(WALLPAPERS.map(p => p.id), ['dusk', 'indigo', 'cotton', 'madder', 'garden', 'dune']);
  assert.equal(wallpaperImage(DEFAULT_WALLPAPER), null);
  for (const preset of WALLPAPERS) {
    assert.equal(wallpaperImage({ id: preset.id, dim: 0.2 }), preset.image);
    assert.ok(preset.en && preset.ur && preset.image.startsWith('radial-gradient('));
  }
  assert.equal(wallpaperImage({ id: 'custom', dim: 0, custom: 'data:image/png;base64,abc' }), 'url("data:image/png;base64,abc")');
  assert.equal(wallpaperImage({ id: 'custom', dim: 0 }), null);
});

test('apply sets preset/photo styles and clears all wallpaper state for none', () => {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (key: string, value: string) => { properties.set(key, value); },
      removeProperty: (key: string) => { properties.delete(key); },
    },
    dataset: {} as Record<string, string>,
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  saveWallpaper({ id: 'indigo', dim: 0.5 });
  applyStoredWallpaper();
  assert.equal(properties.get('--yf-wallpaper'), WALLPAPERS[1].image);
  assert.equal(properties.get('--yf-wallpaper-dim'), '0.5');
  assert.equal(root.dataset.wallpaper, 'preset');
  applyWallpaper({ id: 'custom', dim: 0, custom: 'data:image/png;base64,abc' });
  assert.equal(root.dataset.wallpaper, 'photo');
  assert.equal(properties.get('--yf-wallpaper-dim'), '0');
  applyWallpaper(DEFAULT_WALLPAPER);
  assert.equal(properties.size, 0);
  assert.equal('wallpaper' in root.dataset, false);
});

test('apply is safe without a document', () => {
  Reflect.deleteProperty(globalThis, 'document');
  assert.doesNotThrow(() => applyWallpaper({ id: 'dusk', dim: 0.2 }));
  assert.doesNotThrow(() => applyStoredWallpaper());
});
