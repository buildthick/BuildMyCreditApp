Yep — you’ve got the loop exactly right. Make it rock-solid with a tiny bit of structure so sims and “real” actions line up and stay safe.

# The loop (event-indexed)

Treat **t** as an **event index** (0,1,2,…) — not calendar time.

**Reality loop:**
origin → conso → agg → recs(t) → user decision → origin(+delta) → conso → agg → recs(t+1) …

**Simulation loop:**
(conso snapshot at t=0) → sim-recs(t) with ghost decisions → low/mid/high outcomes (no writes to origin)

# Recommendation doc (works for both sim + real)

`Users/{uid}/Action_Recommendations/{recId}`

* `stepIdx`: integer **t** (0,1,2,…)
* `source`: `"sim"` | `"real"`
* `band?`: `"low"|"mid"|"high"` (for sims only)
* `actionType`: `"OPEN"|"CLOSE"|"PAY"|"WAIT"`
* `targetRef?`: DocRef (for CLOSE/PAY); for OPEN, subtype/issuer hint
* `expectedDelta`: `{ util:-0.03, limit:+2000, cards:+1 }`
* `constraintsHash`: hash of constraints/inputs used to compute this rec
* `consoVersion`: version of stock_conso snapshot used
* `aggVersion`: version of aggregates used
* `status`: `"proposed"|"accepted"|"declined"|"applied"`
* `dependsOn?`: [recId,…] (optional ordering)
* `idempotencyKey`: UUID (so apply is safe to retry)
* `simRunId?`: link to the sim run used (for L/M/H series)
* `created_at`, `updated_at`

> Why these fields?
> They let you (1) display a clean plan, (2) verify nothing changed before applying, and (3) replay/debug later.

# Accept/apply flow (one action)

When user taps “Accept” on a rec:

1. **Revalidate** (fast):

   * Ensure `stock_conso.version === consoVersion`
   * Ensure `aggregates.version === aggVersion`
   * Ensure `hash(currentConstraints) === constraintsHash`
   * If any mismatch → “Plan changed; recomputing recs” (regenerate and re-propose).

2. **Apply in a transaction**:

   * Write **origin** change (live doc)
   * Append **delta** (`history/`)
   * **Project to conso** (only if material hash changed)
   * Optionally update **aggregates** (if you want live totals; otherwise defer to next batch/preview)
   * Mark rec `status:"applied"` and store `applied_at`

3. **Regenerate next recs** for **t+1** (or batch until the user stops).

### Tiny pseudocode (apply)

```ts
await db.runTransaction(async tx => {
  const rec = await tx.get(recRef);
  guard(rec.status === "proposed");

  // revalidate versions/hashes
  const conso = await tx.get(consoRef);
  const agg   = await tx.get(aggRef);
  guard(conso.version === rec.consoVersion && agg.version === rec.aggVersion);
  guard(hash(constraintsNow) === rec.constraintsHash);

  // apply to origin + delta
  const originSnap = await tx.get(originRef);
  const next = applyActionToOrigin(originSnap.data(), rec);
  tx.set(originRef, next, { merge: true });
  tx.set(originRef.collection("history").doc(), makeDelta(originSnap.data(), next, rec));

  // project to conso (idempotent)
  const normalized = normalize(next);
  if (hash(normalized) !== conso.data().hash) {
    tx.set(consoRef, { normalizedFields: normalized, version: (conso.data().version||0)+1, hash: hash(normalized) }, { merge: true });
  }

  // mark applied
  tx.set(recRef, { status:"applied", applied_at: serverTS() }, { merge: true });
});
```

# How sims connect to reality (ghost ↔ real)

* Sim writes **only** to a `SimRuns/{runId}` (or returns arrays) and creates **proposed** recs with `source:"sim"` and `band:"mid"` (you can also keep low/high variants for display).
* When user clicks “Apply this step from the sim,” you **recompute that single step** against current conso/agg, then follow the **Accept flow** above.
* If anything drifted, you transparently regenerate the proposal.

# Cheapness + control tips

* **Batch UI accepts**: let users accept 2–3 steps, then run one CF that applies them sequentially in one go (each step still its own transaction inside the function).
* **Only update aggregates** on preview / after batch (not every micro-change).
* Always keep **`idempotencyKey`** on recs; if the user double-taps, applying twice is a no-op.

# Mental model recap

* **conso** = normalized current truth
* **agg** = rollups/targets
* **recs(t)** = decisions computed off conso+agg+constraints at a specific state
* **apply** = mutate origin (+delta) → refresh conso/agg → compute **recs(t+1)**
* **sim** = same pipeline, but ghost decisions and L/M/H assumptions; no origin writes

That’s the clean, minimal way to get your constraint-driven, open-ended engine working with full safety and clear UX.
