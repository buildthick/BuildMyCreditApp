## TLDR
This is how we get cycleID into plan so it can run like a systems dynamics simulation.
Orchstrator CF writes metadata document under user including cycleID.<br>
Child CF that create action rec collections take cycleID from CF and add to their writes.<br>
Otherwise, they just run without writing cycleID.

## Action Recommendation Cycles: Meta + Actions

This document describes how **action recommendation cycles** are generated and tracked across:

* `plan_meta` (per-user metadata)
* `user_pay_priority_list` (Pay actions)
* And later: Open / Close / Use action lists

The goal is to have a **single cycle ID** that unites all action lists generated at the same time, without breaking standalone testing flows.

---

## Core Concepts

### Cycle

A **cycle** is a single “batch run” of action recommendations across one or more action groups (Pay / Open / Close / Use).

* Identified by a `cycleId` (string: `"0"`, `"1"`, `"2"`, …).
* Logged in `users/{uid}/plan_meta`.
* Stamped on each action list doc when that action was generated as part of that cycle.

### plan_meta

Per-user metadata for recommendation cycles:

* Collection: `users/{uid}/plan_meta`
* Fields (current):

  * `cycleId: string` — The cycle identifier for that batch.
  * `createdAt: Timestamp` — When this cycle meta was created.
  * `monthKey: string` — `"YYYY-MM"` derived from server time when cycle is created.
  * `actionGroupsIncluded: string[]` — Which action groups this cycle intends to cover (currently `['pay']`).

> Later this doc will also store acceptance info (e.g., `scope`, `triggerSource`, etc.) once the user accepts a cycle.

---

## Functions Overview

### 1. `orchestrateActionRecommendations`

**Type:** Callable Cloud Function
**Path:** `exports.orchestrateActionRecommendations`
**Responsibility:**
Generate and log a new `cycleId` for the user, then return it to the client. **Does not call child CFs.**

#### Input

* `data`: *(unused for now)*.
* `context.auth.uid`: required (user must be signed in).

#### Behavior

1. Get `users/{uid}/plan_meta` and:

   * Order by `createdAt` descending.
   * Take the most recent doc (if any).
2. Read `last.cycleId`, parse as integer.
3. Compute `nextCycleNum`:

   * If no previous cycle or invalid value: `0`
   * Else: `prev + 1`
4. Convert to string: `cycleId = String(nextCycleNum)`.
5. Compute `monthKey` from current server time: `"YYYY-MM"`.
6. Write a new document to `users/{uid}/plan_meta`:

   * `cycleId: string`
   * `createdAt: serverTimestamp()`
   * `monthKey: string`
   * `actionGroupsIncluded: ['pay']` (for now)

#### Output

* Returns **only** the `cycleId` as a string.

```ts
// Return type (conceptual)
type OrchestrateActionRecommendationsResult = string; // e.g. "3"
```

#### Usage

In FlutterFlow (or client):

1. Call `orchestrateActionRecommendations()`.
2. Store the returned `cycleId` in app state.
3. Pass that `cycleId` into each child CF you want to be part of this cycle.

---

### 2. `writeAndComputePayPrioritiesListORCH`

**Type:** Callable Cloud Function
**Path:** `exports.writeAndComputePayPrioritiesListORCH`
**Responsibility:**
Compute and persist the **Pay Priority List** for a user, optionally tagging the results with a `cycleId`.

This is the **orchestrator-aware** fork of the original Pay CF.

#### Input

* `data` (object), optional:

  * `cycleID?: string | number`
  * or `cycleId?: string | number` (both supported)
* `context.auth.uid`: required.

#### Modes

There are **two modes**, depending ONLY on whether `cycleId` is provided in `data`.

##### A. Orchestrated Mode (real cycle run)

* `data.cycleID` (or `data.cycleId`) **is present**.
* The function:

  * Normal pay-priority computation.
  * Writes `cycleId` onto each `user_pay_priority_list` document it touches.
  * Does **not** read or write `plan_meta`.

This is the mode used when called after `orchestrateActionRecommendations`.

##### B. Standalone Mode (testing)

* `data.cycleID` / `data.cycleId` **is NOT present**.
* The function:

  * Runs exactly as before (no cycle logic).
  * Does **not** touch `cycleId` fields.
  * Does **not** touch `plan_meta`.

This is used for manual testing / debugging from a button inside the app.

#### Computation (high-level)

1. Load user’s `monthly_budget` from `users/{uid}`.
2. Load consolidated stocks from `user_stocks_conso` (excluding `user_hard_pulls`).
3. Load origin account docs from:

   * `user_credit_cards`
   * `user_loans`
4. Load unpaid lates from:

   * `user_credit_cards_late_payments`
   * `user_loans_late_payments`
5. Load unpaid third-party collections from:

   * `user_collections_3rd_party`
6. Build a working list of items:

   * `kind: 'account' | 'late' | 'collection_from_account' | 'collection_third_party'`
   * Includes APR, minPayment, balance, severity, DOFD tier, etc.
7. Allocate budget in the following steps:

   * (1) Minimum monthly payments (cards + loans)
   * (2) Unpaid lates by severity (180 → 30)
   * (3) Extra principal for cards (Annual Fee → CFA → other, by APR and due date)
   * (4) Collections (account-origin first, then third-party)
8. Track:

   * `minimumPreservationBudget` (mins + unpaid lates, excluding collections)
   * `availableRemainder`
   * `totalAllocated`

#### Persistence

* Target collection: `user_pay_priority_list`
* For each item, the CF builds a `newDataCore` payload with:

  * Common fields (`userRef`, `rank`, `monthlyBudget`, `availableRemainder`, `totalAllocated`, `minimumPreservationBudget`, `isCollectionFromAccount`, `originDocRef`, etc.)
  * Type-specific fields:

    * Accounts: `stockType`, `name`, `lender`, `apr`, `balance`, `minPayment`, `dayOfMonthDue`, `budgetAllocated`, `allocationBreakdown` (mins + cardExtra)
    * Lates: `stockType`, `name`, `lender`, `severity`, `amount`, `budgetAllocated`, `allocationBreakdown.lateSeverityPayment`
    * Collections: `stockType`, `name`, `lender`, `amount`, `budgetAllocated`, `allocationBreakdown.collections`

##### Delta-aware writes

* Existing docs are loaded for this user.
* A reduced version of each (`pickRelevant`) is built from Firestore for comparison.
* `cycleId` is **not** part of `pickRelevant`, so it does **not** influence “core changed?” logic.
* For each new row:

  * If core fields changed OR a `cycleId` is present, the function writes the doc with `merge: true`.

##### cycleId write behavior

* If `cycleId` is **non-null** (orchestrated mode):

  ```js
  payload.cycleId = cycleId;
  ```

  This stamps the cycle ID on each doc in `user_pay_priority_list` affected in this run.

* If `cycleId` is `null` (standalone mode):

  * No `cycleId` field is added or modified.
  * Existing `cycleId` values remain untouched due to `merge: true`.

#### Output

Returns a summary object:

```ts
type WriteAndComputePayPrioritiesListResult = {
  success: boolean;
  count: number;                     // number of items processed
  availableRemainder: number;
  totalAllocated: number;
  minimumPreservationBudget: number;
};
```

---

## Client-Side Orchestration Flow

Current intended flow in the app:

1. **Generate cycle**

   ```pseudo
   cycleId = orchestrateActionRecommendations()
   ```

2. **Run Pay recommendations for that cycle**

   ```pseudo
   writeAndComputePayPrioritiesListORCH({
     cycleID: cycleId
   })
   ```

3. **Later** (once wired): Open / Close / Use CFs will follow the same pattern, each accepting `{ cycleID }` and stamping `cycleId` on their output collections.

---

## Extension Plan (Open / Close / Use)

Each of the remaining recommendation CFs will be updated to:

* Accept an optional `cycleID` (and/or `cycleId`) parameter in `data`.
* If present:

  * Write `cycleId` into each output doc for that action group.
  * Not touch `plan_meta`.
* If absent:

  * Run in standalone testing mode with no cycle writes.

All of them will share the same **client-side orchestration pattern**:

```pseudo
cycleId = orchestrateActionRecommendations()

writeAndComputePayPrioritiesListORCH({ cycleID: cycleId })
writeOpenActionsList({ cycleID: cycleId })   // future
writeCloseActionsList({ cycleID: cycleId })  // future
writeUseCardsList({ cycleID: cycleId })      // future
```
