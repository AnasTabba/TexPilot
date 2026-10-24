# 01 — Product Specification

## 1. Context: the paper registers being replaced
The factory currently keeps three registers. The app must reproduce all of their information,
and the "Register View" screens must mirror these column orders exactly.

**A. Yarn / Lot Sheet** (one page per yarn + lot)
- Header: Yarn, Lot No.
- Receipt block: Date Received | Cartons Received | Cartons Issued (To Date) | Cartons in Stock
- Issue block: Date Issued | Shift/Machine | Cartons Issued | Cones Issued | Cops Rec'd (Produced) |
  Cops Issued to TFO (TFO Mc# | No. of Cops) | Cops Stock (Balance)

**B. Production Register**
- Date | Machine | Yarn Spec | Lot No. | Cartons | Cones | Weight
- Real examples: `14/08/26 | 1A | 50/24/1244 Z | 1221 | 12 | 288 | 258.66 kg`;
  mixed lots appear as e.g. `1219 (5) + 1221 (5)`.

**C. Daily Summary** (3 days per page)
- Date; Production (Machine | Yarn Spec | Lot No. | Cartons | Weight);
  Delivery (Machine | Yarn Spec | Cartons | Weight); Stock Balance (Yarn Spec | Cartons | Weight)

**Known problems to solve:** raw material has no weight (no yield possible); overwritten numbers;
mixed lots written in margins; delivery has no lot/customer/gate pass; shift and machine share a
column; balances computed by hand; inconsistent formats ("1a" vs "1A"); same data written 2–3 times.

## 2. Material flow
```
Yarn Receipt (cartons/cones/kg) → Issue to Machine (shift) → Cops Produced
  → Cops Issued to TFO → Finished Production (cartons/cones/kg) → Dispatch → Customer
                                                 ↘ Waste (kg)
```
Not every product passes every stage. A spec can be marked as `traded` (receive → dispatch only)
or `manufactured` (full flow). Stages are configurable per product type.

## 3. Roles & permissions
| Capability | Operator | Supervisor | Manager | Owner |
|---|---|---|---|---|
| Create entries (assigned task types only for Operator) | ✓ | ✓ | ✓ | ✓ |
| View own entries today | ✓ | ✓ | ✓ | ✓ |
| View all entries / search / reports | — | ✓ | ✓ | ✓ |
| Edit or void (with reason) | own entry within 5 min (undo) | ✓ (unlocked days) | ✓ | ✓ |
| Day Close approve / reopen | — | approve | approve + reopen | ✓ |
| Dashboard | — | limited (own section) | ✓ | ✓ |
| Master data | — | — | ✓ | ✓ |
| Users, month lock, settings, exports of everything | — | — | — | ✓ |

Permissions are configurable per user on top of role defaults.

## 4. Master data (all editable by Manager/Owner; archive, never delete)
- **Product type:** Spun yarn | Filament yarn.
- **Spun yarn spec:** Count Ne (seed 16, 20, 26, 30; editable), Ply (Single/Double → `30/1`, `20/2`),
  Content (Cotton, PC, CVC; editable), Blend ratio (required for PC/CVC: e.g. 65/35, 52/48, 60/40, 80/20),
  optional Process (Carded/Combed/Compact), optional Spinning (Ring/Open-End).
- **Filament yarn spec:** Denier / Filaments / TPM / Twist (S|Z), e.g. `50/24/1244 Z`.
- **Spec label** is auto-generated: `30/1 CVC 60/40 Combed`, `50D/24F 1244 TPM Z`.
  Labels are stored with each transaction as a snapshot, so renaming a spec later never alters history.
- **Lots:** lot no. (unique per supplier+spec), spec, supplier, received date, status
  (Active | QC Hold | Closed), notes.
- **Machines** (seed 1A, 1B, 2A, 2B, 3A, 3B), **TFO machines**, **Shifts** (A/B/C with start/end
  times; a shift may cross midnight), **Operators**, **Suppliers**, **Customers** (name, contact person,
  phone, WhatsApp, city, address, NTN/STRN optional, credit notes), **Fabric types** (seed Fleece,
  Single Jersey, Polo PK, Thermal), **GSM bands**, **Waste types** (Hard, Soft, Sweepings…),
  **Downtime reasons**, **Void reasons**, **Holiday calendar**.
- **Packing defaults per spec:** usual cones per carton, usual net kg per cone (min/max tolerance %).
  Used for smart defaults and anomaly warnings.

## 5. Transactions
Every transaction has: `id (uuid, client generated)`, `serial` (server assigned, human readable,
per type per year: `GRN-26-000045`), `business_date`, `shift`, `created_by`, `created_at` (server),
`device_time`, `device_id`, `status` (pending_sync | posted | needs_attention | voided), `notes`,
optional photo attachments.

| # | Transaction | Fields | Stock effect |
|---|---|---|---|
| 1 | **Yarn Receipt (GRN)** | supplier, supplier invoice no., spec, lot (pick or create), cartons, cones, gross kg, tare kg, net kg (auto = gross − tare, editable if scale gives net), invoice photo | + raw stock |
| 2 | **Issue to Machine** | machine, lot, cartons, cones, kg (auto-suggested from avg) | − raw stock, + machine WIP |
| 3 | **Cops Produced** | machine, lot, no. of cops | + cops stock |
| 4 | **Cops Issued to TFO** | TFO machine, lot, no. of cops | − cops stock |
| 5 | **Finished Production** | machine (TFO or winding), spec, lot lines (≥1; each with cones), cartons, total cones, net kg; optional per-carton weights | + finished stock (per lot line, kg split pro-rata by cones unless per-carton weights given) |
| 6 | **Waste** | machine, lot, waste type, kg | − WIP (for yield) |
| 7 | **Customer Order** | customer, fabric type, GSM, required date, rate per kg (optional), order lines (spec, kg) | none (commitment) |
| 8 | **Dispatch / Delivery Note** | customer, linked order (optional), DC/gate pass no., vehicle no., driver name & phone, lines (spec, lot, cartons, kg) | − finished stock |
| 9 | **Customer Return** | linked delivery note, lines, reason, QC decision | + finished stock or + waste |
| 10 | **Stock Adjustment** (Owner/Manager) | spec, lot, location, qty ±, reason (count difference, damage…) | ± stock |
| 11 | **Physical Stock Count** | count sheet per location; system shows variance; posting creates adjustments | via adjustments |
| 12 | **QC Test** (Phase 3) | lot, count/denier, TPM, strength/CSP, elongation, result Pass/Hold/Reject | Hold blocks dispatch of that lot |
| 13 | **Machine Downtime** (Phase 3) | machine, start, end, reason | none |

## 6. Calculations (read-only, derived)
- Raw stock per spec/lot: cartons, cones, kg.
- Cartons issued to date per lot; cartons in stock per lot (= Register A columns).
- Cops balance per lot = produced − issued to TFO (= Register A last column).
- Finished stock per spec/lot: cartons, kg.
- Pending order kg per order line = ordered − dispatched (+ returns logic).
- Avg net kg per cone, avg cones per carton (per spec, rolling 30 days).
- Yield % = finished kg ÷ issued kg for the lot (when the lot is closed, or rolling estimate).
- Waste % = waste kg ÷ issued kg.
- Stock aging = days since receipt (raw) / production (finished), FIFO.
- Days of cover = current stock kg ÷ avg daily consumption/dispatch (last 30 days).
- Production vs target per machine/shift (targets configurable per machine per spec).

## 7. Yarn Selection Guide
Admin-editable table: Fabric + GSM range → recommended specs (count, ply, content), with notes.
Seed (indicative; the factory will correct):
| Fabric | GSM | Recommended count |
|---|---|---|
| Single Jersey | 120–140 | 30s–34s |
| Single Jersey | 150–180 | 24s–26s |
| Single Jersey | 180–200 | 20s–24s |
| Polo PK | 180–220 | 24s–30s |
| Thermal | 180–240 | 20s–24s |
| Fleece (3-thread) | 260–320 | face 20s–30s + back 10s–16s |

In *New Order*, after choosing fabric + GSM, show matching specs with live available kg/cartons.
The user selects with one tap. If nothing matches, show the closest specs and say so in plain words.

## 8. Dashboard (decision-first)
Order of information on the dashboard: **(1) What needs attention now → (2) Today vs normal →
(3) Trends → (4) Detail.** Every number taps through to the entries behind it.

1. **Attention panel:** low stock (below days-of-cover threshold), abnormal weights, QC-hold lots,
   orders due in ≤ 3 days with shortfall, idle machines, entries needing attention (sync rejects),
   voids/edits today, days not closed.
2. **Today KPIs** (each with comparison to 7-day average): production kg & cartons, dispatch kg,
   finished stock kg, raw stock kg, cops WIP, yield %, waste %, pending order kg.
3. **Production:** daily kg trend with target; by machine; by shift; machine utilisation & downtime.
4. **Quality/consistency:** avg kg per cone by spec/lot with tolerance band; QC results.
5. **Inventory:** stock matrix Count × Content (kg, cartons, colour by days-of-cover); aging buckets
   (0–15, 16–30, 31–60, 60+ days); fast vs slow movers.
6. **Sales:** demand by fabric type and GSM band over time; dispatch by customer; order vs stock
   match with shortfall; customer profile (usual fabric/GSM/count, frequency, last order, avg rate).
Global filters: date range, product type, count, content, spec, lot, machine, shift, customer,
fabric, GSM band. Filters persist per user.

## 9. Reports (all exportable to PDF and Excel; Urdu and English)
Daily Summary (replaces register C) · Lot Ledger (replaces register A) · Production Register
(replaces register B) · Paper-Match report (exact layout of the old registers, for the parallel run)
· Machine/Shift report · Stock report · Stock aging · Order status · Customer ledger ·
Delivery note PDF · Audit report (voids/edits) · Physical count variance.

## 10. Sharing & notifications
- End-of-shift and end-of-day summary to Owner via WhatsApp (link/PDF), with email optional.
  Phase 1: generate the message + PDF and open WhatsApp share (`wa.me` / Web Share API).
  Phase 3 (optional): WhatsApp Business API for fully automatic sending.
- Delivery note PDF to customer via WhatsApp share.
- In-app notifications for the attention-panel items.

## 11. Migration & onboarding
- Excel/CSV import (masters, opening stock per lot, historical entries) with a preview, row-level
  errors in plain words, and "import valid rows only" option.
- Opening-balance wizard per spec/lot.
- Optional (Phase 3): photograph a register page → OCR → editable grid → user confirms each row.
  Low-confidence cells are highlighted; nothing is saved without human confirmation.
- Practice Mode with seeded dummy data (see 04-SCREENS).
- Parallel-run period with the Paper-Match report.

## 12. Localisation
English / Urdu per user. Timezone Asia/Karachi. Dates dd/mm/yyyy. Currency PKR. Number grouping
setting: international (1,234,567) or South Asian (12,34,567). Digits always Western (0–9) even in
Urdu, isolated as LTR runs inside RTL text.
