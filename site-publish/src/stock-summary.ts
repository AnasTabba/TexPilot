type LotQuality = { id: string; quality: string };
type Balance = { lot_id: string; grams: number };
type Movement = { created_at: number; from_stage: string | null; to_stage: string | null; grams: number };
export function availableForDispatch(lots: LotQuality[], balances: Balance[]) {
  const approved = new Set(lots.filter(l => l.quality === 'approved').map(l => l.id));
  return balances.reduce((sum, b) => sum + (approved.has(b.lot_id) ? b.grams : 0), 0);
}
export function stockHistory(movements: Movement[], currentGrams: number) {
  const chronological = [...movements].sort((a,b) => a.created_at - b.created_at);
  const delta = (m: Movement) => (!m.from_stage ? m.grams : 0) - (!m.to_stage ? m.grams : 0);
  let grams = currentGrams - chronological.reduce((sum,m) => sum + delta(m),0);
  return chronological.map(m => ({ time: m.created_at, grams: grams += delta(m) }));
}
