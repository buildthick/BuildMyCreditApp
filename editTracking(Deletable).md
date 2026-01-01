### Files we will edit (short + explicit)

1. **`simulatePlan.js`**

   * Replace fixed-month loop with `while (month < 120 && !allDone)`
   * Add stopping condition checks (open / close / pay / use / util / age)
   * Track `totalMonths`

2. **`loadSimulationInputs.js`**

   * Load full `/credit_high_achiever_metrics`
   * Pass only `LH_averageAgeMonths` into `SimulationState`

3. **`SimulationState.js`**

   * Add fields:

     * `_openMeta`
     * `_closeMeta`
     * (optional) marker flags / helper getters
   * Ensure snapshots include these metas

4. **`runOpenCycle.js`**

   * After computing `neededTotal`, write:

     * `state._openMeta = { neededTotal }`

5. **`runCloseCycle.js`**

   * After computing close candidates, write:

     * `state._closeMeta = { candidateCount }`

6. **`writeSimOutputs.js`**

   * Compute `t_*` markers from snapshots
   * Write **one** summary doc:

     * `summary_run_${runId}` into `/user_sim_stocks_conso`

That’s it.
No Pay / Use engine changes required.

When you’re ready, send **`simulatePlan.js` first** and we’ll do it surgically.
