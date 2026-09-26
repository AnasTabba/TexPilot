/**
 * Friendly names for the wire contract. The shapes themselves are generated
 * from services/api/schemas.py into schema.gen.ts -- run `npm run gen:api`
 * after the Python schema changes. Do not hand-write API shapes here.
 */

import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type ScanResult = Schemas['ScanResult'];
export type Verdict = Schemas['Outcome'];
export type HeadPrediction = Schemas['HeadPrediction'];
export type StatedComposition = Schemas['StatedComposition'];
export type FiberComponent = Schemas['FiberComponent'];
export type Flag = Schemas['FlagModel'];
export type CaptureQuality = Schemas['CaptureQuality'];
