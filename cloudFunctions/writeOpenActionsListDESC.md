# Cloud Function: `writeOpenActionsList`

### Overview

This callable Cloud Function generates a record in the top-level collection `/user_open_actions_list`.
It determines how many **new credit accounts** (cards or loans) a user should open during the current plan cycle, based on target goals, allocation rules, timing constraints, and user settings.

---

## 1. Purpose

The function runs whenever a user triggers an update or monthly recomputation.
It produces a proposed “open actions” plan for that user, storing:

* **Goal totals** (how many total accounts are needed)
* **Allocation** between cards and loans
* **Timing and eligibility** (caps and intervals)
* **Next eligible date** (if blocked)
* **Execution sequence** (order of openings)

It’s the authoritative source for how the app decides when and what to open next.

---

## 2. Input Sources

| Source Collection                           | Purpose                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/users/{uid}`                              | Reads user flags `wantsToAllowLoans`, `imposeMaxLoanNumber`                                                                                            |
| `/user_openAndCloseAdjustments`             | Provides tuning knobs like “Revolving % of total,” “Max loans allowed,” and timing parameters (“Yearly opens allowable,” “Min interval between opens”) |
| `/credit_high_achiever_account_numbers`     | Global reference goals for credit mix; used for CHA path of target calculation                                                                         |
| `/user_stocks_conso`                        | Main data source for current account counts, lates, collections, open dates, and hard pulls                                                            |
| `/users/{uid}/plan_meta/open_actions_epoch` | Baseline doc created on first run; stores `baseline_open_loans` for applying future-loan caps correctly                                                |

---

## 3. Logic Flow

### Step 1. **Compute Goal**

Determine how many total accounts the user *should* have.

Two possible paths:

* **Path A:**
  `User_Value("Current accounts / lates") × (number of late + collection rows)`
  *(uses “financially current” accounts as multiplier)*

* **Path B:**
  Sum of all numeric `Value` fields from `/credit_high_achiever_account_numbers`.

> **Goal total** = whichever is greater of Path A or Path B.

---

### Step 2. **Compute Current State**

Count currently existing accounts (not “financially current” — just open).

* Cards: all docs in `user_stocks_conso` where `isOpen == true` and `stockType == "user_credit_cards"`.
* Loans: all docs where `isOpen == true` and `stockType == "user_loans"`.

Also gather:

* Most recent open date and type (card vs. loan)
* Number of opens in last 365 days
* Number of requests (hard pulls) in last 180 days
* Most recent request date

---

### Step 3. **Calculate Needed Total**

`neededTotal = goalTotal - currentOpenTotal`
If result ≤ 0 → status = `done` (no further openings needed).

---

### Step 4. **Baseline & Future-Loan Cap**

Before allocation, ensure the user has a fixed plan baseline:

* Check for `users/{uid}/plan_meta/open_actions_epoch`.
* If missing, create it with `baseline_open_loans = current openLoans`.
* On all future runs, read and reuse this baseline (never overwritten).

> **loansOpenedSinceStart = openLoans - baseline_open_loans**

If `imposeMaxLoanNumber` is true, the **loan cap** applies only to *future* loans:

```
loanCapRemaining = max(0, maxLoansAllowed - loansOpenedSinceStart)
```

Existing loans at plan start do **not** count against this cap.

---

### Step 5. **Allocate Between Cards and Loans**

Rules:

1. If `wantsToAllowLoans == false`:
   → all needed accounts become cards.

2. If `imposeMaxLoanNumber == true`:

   * Use `loanCapRemaining` from Step 4.
   * Use `User_Value("Revolving % of total")` to determine minimum card share.
   * Allocate remaining slots to loans, up to cap.

3. Otherwise (loans allowed, no cap):

   * Use `Revolving %` to determine card share, remainder to loans.

If rounding shortfall occurs, extra slots go to cards to maintain total.

---

### Step 6. **Timing Constraints**

From `/user_openAndCloseAdjustments` rows with `Type == "Time"`:

* `Yearly opens allowable`
* `Half-yearly requests allowable`
* `Min interval between opens in LTM`
* `Min interval between requests in LTM`

Then, from `user_stocks_conso`:

* Count opens in last 365 days
* Count requests in last 180 days
* Find most recent open/request timestamps

Compute:

* **Yearly headroom:** `yearlyMax - opensIn365`
* **Half-year headroom:** `halfYearMax - requestsIn180`
* **Intervals satisfied?** true if both recent actions are older than the min interval values.

---

### Step 7. **Determine Eligibility**

If:

* both caps have headroom, **and**
* both intervals are satisfied, **and**
* `neededTotal > 0`

→ user **can open now**.

If interval(s) still running, CF sets:

* `can_open_now = false`
* `next_eligible_date = later of (nextByOpenInterval, nextByReqInterval)`

If caps exceeded, block reason = `"yearly_cap_reached"` or `"halfyear_requests_cap_reached"`.
If both exceeded and intervals pending, reason = `"caps_and_intervals"`.

---

### Step 8. **Generate Sequence**

If user can open now, generate a `sequence_now` array of account types:

* Start by alternating opposite of the **most recent type opened**.
* If that type is capped or unavailable, fallback to remaining type.
* If multiple opens allowed immediately (interval = 0), fill up to allowed slots; otherwise only 1 per run.

Example:

```json
"sequence_now": ["card", "loan", "card"]
```

---

### Step 9. **Write Output**

A new document is created in the top-level collection:

```
/user_open_actions_list
```

Key fields:

```json
{
  "userRef": <DocumentReference>,
  "status": "proposed" | "done" | "blocked",
  "proposed": {
    "can_open_now": true,
    "count_now": 1,
    "sequence_now": ["card"],
    "next_eligible_date": null,
    "cadence_months": {
      "opens_min_interval": 2,
      "requests_min_interval": 1
    }
  },
  "allocation": {
    "goal_total": 16,
    "current_open_cards": 3,
    "current_open_loans": 2,
    "needed_total": 11,
    "revPctMinCards": 70,
    "loan_cap_remaining": 1,
    "cards_to_open": 10,
    "loans_to_open": 1
  },
  "timing": {
    "opens_in_365": 1,
    "requests_in_180": 0,
    "yearly_opens_max": 6,
    "halfyear_requests_max": 3,
    "is_blocked_caps": false,
    "is_blocked_intervals": false
  },
  "meta": {
    "baseline_open_loans": 2
  }
}
```

---

## 4. Behavior Summary

| Condition                 | Outcome                                                   |
| ------------------------- | --------------------------------------------------------- |
| All constraints satisfied | Creates `status: "proposed"`, user can open now           |
| NeededTotal = 0           | Creates `status: "done"` (no new accounts needed)         |
| Interval or cap blocking  | Creates `status: "blocked"` and sets `next_eligible_date` |
| First run ever            | Seeds `plan_meta/open_actions_epoch` with baseline loans  |
| Subsequent runs           | Reuses epoch; baseline never overwritten                  |

---

## 5. Future Extensions

* Add deterministic `period_key` (e.g., monthly) for easier rerun detection and versioning.
* Extend sequence logic to respect product categories or credit-tier ranking.
* Integrate logging of “block reasons” into a `/diagnostics` subcollection for UI transparency.

---

## 6. Notes

* All timestamps use **New York time** to match FICO/credit-reporting cycles.
* Fractional months are supported (e.g., 0.5 = two weeks).
* CHA collection is treated as **global** (no `userRef` filter).
* “Current” means *existing now*, not *financially current*, except in the multiplier calculation.
* Loan cap only limits **future loans opened after plan start**.
