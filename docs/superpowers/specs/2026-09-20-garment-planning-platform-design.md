# Garment Production Planning Platform — Design

**Date:** 2026-09-20
**Project:** TexPilot (FYP, CSE 493/494, IBA SMCS)
**Sub-projects:** 2 (goods-in bridge) and 3 (planning platform)
**Milestones:** M2–M4
**Status:** Approved design, deferred behind the scanner (M1). Companion to `2026-09-20-fabric-verification-scanner-design.md`.

Implements `FYP_Industrial_Production_Optimization_SRS.docx` (Core Scope, §6.1), specialised to garment manufacturing.

---

## 1. Domain model

### 1.1 The granularity decision

A buyer PO is never for "a product". It is for a **style**, in a **colorway**, across a **size curve** — e.g. `M-1042 Men's Polo / Navy / S:M:L:XL:XXL = 1:2:3:2:1`.

Sizes are **not** an optimizer index. Sizes share one routing, one operation bundle, near-identical SMV, and are cut together in a single lay from the same fabric roll. They are never scheduled independently, so indexing by size multiplies variables ~6× for zero decision value.

**The optimizer's product index `p` is `ProductionSKU = Style × Colorway`.** The size curve is an attribute that expands in exactly three places: fabric consumption (curve-weighted average), cut planning, and packing.

Consequence: ~6,000 setup binaries (50 SKUs x 10 lines x 12 weeks) instead of ~36,000 if a ~6-size curve were indexed explicitly.

### 1.2 Entities

| Layer | Entities | Notes |
|---|---|---|
| Commercial | `Buyer`, `PurchaseOrder`, `POLine` | POLine = style × colorway × qty × size curve × ship date. Late shipment is a chargeback, not merely a penalty term |
| Product | `Style`, `Colorway`, `SizeCurve`, **`ProductionSKU`** | `Style` owns SMV and the operation bundle |
| BOM | `Fabric`, `Trim`, `StyleBOM` | Two-tier: fabric (metres + wastage %) and trims (buttons, zips, labels, thread). Fabric attributes seeded from FabricsCompositionDataset |
| Routing | `Stage`, `Operation`, `StyleRouting` | Cutting → [Print/Embroidery] → **Sewing** → [Wash/Dye] → Finishing → Packing |
| Capacity | `Plant`, `SewingLine`, `CuttingRoom`, `WashPlant`, `Shift`, `LaborCalendar` | |
| Supply | `Supplier`, `SupplierFabric`, `PurchaseRequisition` | Fabric lead times of 30–60 days dominate the plan |
| Inventory | `FabricInventory`, `TrimInventory`, `FinishedGoods` | Fabric tracked **by dye lot**; lots cannot be mixed within one garment |

### 1.3 Capacity is standard minutes, not machine-hours

```
capacity_minutes = operators × minutes_per_shift × line_efficiency
```

A 40-operator line at 480 min/shift and 55% efficiency yields **10,560 standard minutes/day**; a 13-SMV polo therefore runs ~812 pcs/day. Machine count is not the binding resource — operator minutes are.

Fabric costing links the real dataset attributes to the cost model:

```
kg_per_garment = gsm × width_m × consumption_m / 1000
```

At 180 gsm, 1.5 m width, 1.8 m/polo → 0.486 kg/garment. Fabric is purchased per kg, so `weight_gsm` feeds material cost directly.

### 1.4 The two distinguishing constraints

**Operator learning curve.** Starting a new style on a line drops efficiency, recovering over several days (~50% → 100% across 3–7 days). Modelled as a multiplier `η(d)` on line capacity, `d` = days since style start. Consequence: long runs are cheaper per unit than short runs, creating genuine economic tension between batching and hitting many small PO ship dates. Generic job-shop models have no equivalent.

**Sequence-dependent changeover.** Polo → polo is cheap; polo → jacket means re-laying the line and retraining. Modelled with a style-family similarity matrix driving setup time, consumed by the operational layer.

### 1.5 Deviations from the SRS

| SRS | This design | Why |
|---|---|---|
| §14 Product Master | Style / Colorway / SizeCurve / ProductionSKU | A flat product master cannot express a size curve |
| §17 Machine Capacity | Sewing-line capacity in standard minutes | Operator minutes bind, not machines |
| §16 routing with processing/setup times | Same, plus learning curve `η(d)` | Static processing time misrepresents a sewing line |
| §15 multi-level BOM | Two-tier fabric + trims | Garment BOMs are wide and shallow, not deep |

These restate the same requirements in the domain's vocabulary; they do not reduce scope.

---

## 2. Optimizer architecture

Two layers, split along the seam garment factories already use.

| | Tactical | Operational |
|---|---|---|
| Solver | MILP (HiGHS) | CP-SAT (OR-Tools) |
| Bucket | Weekly | Daily |
| Scope | 12-week rolling horizon, all lines | One week, all lines jointly |
| Decides | what, how much, which line, which week + purchasing | sequence, day, wash batch |
| Learning curve | approximated `η̄` (week average) | exact `η(d)` |

Operational solves a **whole week across all lines at once**, not line-by-line: lines are independent within a week *except* through shared downstream resources (cutting room, wash plant), and a per-line solve would let two lines both claim the same wash capacity.

### 2.1 Tactical model

Indices: `p` ProductionSKU (~50), `l` SewingLine (~10), `t` week (12), `m` material (~200), `s` supplier, `o` PO line.

```
X(p,l,t)    units of p on line l in week t          continuous
Y(p,l,t)    p is set up on line l in week t          binary
I(p,t)      finished-goods inventory, end of week t
Pur(m,s,t)  material m purchased from s in week t
OT(l,t)     overtime minutes
Wsh(p,t)    kg of p through the wash plant
Out(p,t)    units subcontracted (CMT)
S(o,t)      units of PO line o shipped late
```

Constraints (the remainder are SRS §24.2 restated in garment units):

```
line capacity     Σ_p X(p,l,t)·SMV(p) ≤ Cap(l,t)·η̄(p,l,t) + OT(l,t)
setup link        X(p,l,t) ≤ M·Y(p,l,t)
min run length    X(p,l,t) ≥ MinRun(p)·Y(p,l,t)
styles per line   Σ_p Y(p,l,t) ≤ MaxStyles(l)          # realistically 1–3
fabric arrival    Σ consumption ≤ Σ_s Pur(m,s,t−LeadTime(m,s))
wash batch cap    Σ_p Wsh(p,t) ≤ WashCap(t)             # kg
ship date         Σ_{t ≤ due(o)} ship(o,t) ≥ Qty(o) − S(o,t)
```

`MinRun` and `MaxStyles` prevent a mathematically optimal plan that fragments 50 styles across 10 lines — a plan no floor supervisor would accept.

**Objective:** minimise CMT + fabric + trims + holding + overtime + setup + wash + subcontract + `λ`·late-unit chargeback.

**Size:** ~6,000 binaries, ~20k variables. HiGHS closes this in seconds to minutes on an M3 under Rosetta.

### 2.2 The seam

Four explicit, versioned, persisted DTOs — the contract three people build against independently:

```
TacticalInput          frozen master-data snapshot + demand + inventory + calendar
  → TacticalPlan       weekly line loading + purchase plan + KPIs + shadow prices
    → OperationalInput   one week's loading + changeover matrix + η(d) params
      → OperationalSchedule   day-level intervals + realized output + changeover cost
```

### 2.3 Feedback loop

Tactical plans against approximate `η̄`; operational computes exact `η(d)`. They will disagree.

When realized output falls short of planned by more than tolerance `ε`, the realized efficiency is written back as a corrected `η̄` and tactical re-solves. **Capped at 2–3 iterations**, then the current plan is accepted and the residual gap reported.

This is iterative aggregation–disaggregation. It is the mechanism that makes the learning curve actually bind on the plan rather than being a display-only attribute, and it gives the M5 report genuine algorithmic content.

### 2.4 Infeasibility: elastic by construction

SRS §25 requires the system never report "no solution found". Neither HiGHS nor OR-Tools computes an irreducible infeasible subsystem, so that route is not taken.

Instead, every soft-able constraint class carries a slack variable with a large, **ranked** penalty — unmet demand, overtime beyond policy, warehouse overflow, late shipment, capacity breach. The model is then always feasible, and infeasibility surfaces as *which slacks activated, by how much, at what penalty*:

> "Line 3 is short 84 standard-minutes for Style M-1042 in week 6."

— which is literally the activated slack and its magnitude, satisfying §25 almost for free.

Hard constraints stay hard and genuinely fail: batch-size integrality, supplier capacity, dye-lot integrity.

**Note:** this deviates from §24.4's wording on hard constraints. It trades "the model told me it is infeasible" for "the model told me exactly what it had to break". Raise with the advisor.

### 2.5 Solver ports

```
TacticalSolverPort    → HiGHSAdapter | ORToolsMILPAdapter | (GurobiAdapter)
OperationalSolverPort → CPSATAdapter
```

Satisfies SRS §24's swappability requirement and yields a cheap benchmark table for the report: same instance, HiGHS vs OR-Tools, runtime and optimality gap.

---

## 3. Goods-in bridge (sub-project 2)

Connects the scanner to the platform:

1. Fabric arrives against a PO.
2. Operator scans it with the TexPilot app.
3. Scanner verdict is checked against the PO's `expected_fabric_id` and its specified composition.
4. On `PASS`, a `FabricInventory` receipt is written with its dye lot, quantity, and the scan record as evidence.
5. On `FLAG`, the receipt is held for supervisor review; the scan record is the audit evidence.

This makes the scanner the platform's goods-in QC front-end rather than an unrelated app, and it is the natural M4 real-conditions deployment.

---

## 4. Phase ordering

The SRS (§48) places the optimization engine at phase 8, after schema, master data, forecasting, inventory and the cost engine. Followed literally, the team would reach a milestone with a database and no algorithm.

**Revised order:** the tactical MILP is built against in-memory fixtures first and persisted later. Schema work follows a solver that already runs.

---

## 5. Open items

These are deferred, not decided, and are expected to be settled before this sub-project's implementation plan is written:

- Service architecture and module boundaries (FastAPI service decomposition)
- SQL Server schema and ER diagram (SRS Part VI)
- Scenario engine and explainability layer detail (SRS §26–27)
- Testing strategy for the platform (SRS §45)
- Forecasting module design (SRS §23)
- RBAC, audit, approval workflow (SRS §41–44)

---

## 6. Known constraints

- **SQL Server has no arm64 container image.** On the team's Apple M3 it runs under Rosetta emulation — workable, noticeably slower. Azure SQL Edge, the former arm64 option, is retired. With a solver and a dev server alongside on 16 GB, memory is tight. Plan for it rather than discover it.
- SRS §49's sizing (200–500 products, 700–1000 materials, 10–15 lines) was never checked against solver limits and is not reachable with §24.1's variable structure. The sizing in §2.1 above supersedes it.
