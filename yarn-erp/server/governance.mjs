import { all, one, fail, integer, text } from './erp-utils.mjs';
export const THRESHOLDS = ['purchase','inventory_adjustment','claim','dispatch_stock_issue'];
export const DEFAULT_SETTINGS = { currency: 'PKR', tax_rate_bp: 1800, invoice_format: 'INV-{YYYY}-{NNNN}', reminder_hours: 24, credit_alert_days: [7, 3] };
export async function settingsOf(db, workspaceId) {
  const settings = { ...DEFAULT_SETTINGS, credit_alert_days: [...DEFAULT_SETTINGS.credit_alert_days] };
  for (const row of await all(db, 'SELECT key,value_json FROM settings WHERE workspace_id=?', workspaceId)) settings[row.key] = JSON.parse(row.value_json);
  return settings;
}
export async function thresholdOf(db, workspaceId, type) {
  const row = await one(db, `SELECT value FROM thresholds WHERE workspace_id=? AND type=? AND
    (currency IS NULL OR currency=COALESCE((SELECT json_extract(value_json,'$') FROM settings WHERE workspace_id=? AND key='currency'),'PKR'))`, workspaceId, type, workspaceId);
  return row?.value ?? null;
}
export function settingValue(key, value) {
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) fail(422, 'Choose a valid setting.');
  if (key === 'currency') { if (!['PKR','USD','EUR','GBP'].includes(value)) fail(422, 'Choose a supported currency.'); return value; }
  if (key === 'tax_rate_bp') return integer(value, 'Tax rate', 0, 10000);
  if (key === 'reminder_hours') return integer(value, 'Reminder hours', 1, 720);
  if (key === 'invoice_format') {
    const format = text(value, 'Invoice format', 6, 40);
    if (format !== value || (format.match(/\{YYYY\}/g) ?? []).length !== 1 || (format.match(/\{NNNN\}/g) ?? []).length !== 1 || !/^[A-Za-z0-9/-]*$/.test(format.replace('{YYYY}', '').replace('{NNNN}', ''))) fail(422, 'Use exactly one {YYYY} and one {NNNN}, with letters, numbers, / or -.');
    return format;
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 5 || new Set(value).size !== value.length) fail(422, 'Choose 1–5 distinct credit alert days.');
  return value.map(day => integer(day, 'Credit alert days', 1, 90)).sort((a,b) => b-a);
}
