# Open Actions Engine — Description

## Purpose

Compute how many new **accounts** (cards/loans) you should open, **when** you’re allowed to open them (caps + intervals), and **what type(s)** to open **now**. Output a single “rule” doc to `/user_open_actions_list` that the UI uses to let the user pick specific products from `/user_card_recommendations`.

---

## Data sources (all top-level, filtered by `userRef`)

* `users/{uid}`:

  * `wantsToAllowLoans` (bool)
  * `imposeMaxLoanNumber` (bool)
* `user_openAndCloseAdjustments`:

  * `User_Value("Current accounts / lates")`
  * `User_Value("Revolving % of total")` (cards minimum share as a percent)
  * `User_Value("Max loans allowed")`
  * `Type == "Time"` rows:

    * `Yearly opens allowable`
    * `Half-yearly requests allowable`
    * `Min interval between opens in LTM` (months, may be fractional)
    * `Min interval between requests in LTM` (months, may be fractional)
* `credit_high_achiever_account_numbers`: sum of `Value` across Cards + Loans
* `user_stocks_conso`:

  * Identify **cards** (`stock == "user_credit_cards"`) and **loans** (`stock == "user_loans"`)
  * “Current/open” = `isOpen == true` **AND** `isCurrent == true`
  * Open date = `DOFRecord`
  * Lates and collections rows (count them as rows; **no dedupe**)
* `user_hard_pulls`:

  * Request date = `DOFRecord`

All “today” calculations use **America/New_York** time.

---

## Step 1 — Goal (total accounts to open)

Compute two candidates and take the max:

* **Path A:** `User_Value("Current accounts / lates") × (count_lates + count_collections)` from `user_stocks_conso`
* **Path B:** `sum(Value)` across `credit_high_achiever_account_numbers`
  → `goal_total = max(Path A, Path B)`

> Lates/collections are counted at the level of each row (no deduping by account).

---

## Step 2 — Current value (what you already have)

From `user_stocks_conso`:

* `open_cards = count(cards where isOpen && isCurrent)`
* `open_loans = count(loans where isOpen && isCurrent)`
* `current_open_total = open_cards + open_loans`

Include CFA and AF cards; other CFs may remove them later.

---

## Step 3 — Needed total

`needed_total = max(0, goal_total - current_open_total)`

---

## Step 4 — Allocation (how many cards vs loans)

Let `revPctMinCards = User_Value("Revolving % of total")`.

Case logic:

1. `wantsToAllowLoans == false`

   * `cards_to_open = needed_total`, `loans_to_open = 0`

2. `wantsToAllowLoans == true && imposeMaxLoanNumber == true`

   * `loan_cap = max(0, User_Value("Max loans allowed") - open_loans)`
   * `min_cards = ceil(revPctMinCards/100 × needed_total)`
   * Start: `cards_to_open = min(needed_total, min_cards)`
   * `loans_to_open = min(needed_total - cards_to_open, loan_cap)`
   * If `cards_to_open + loans_to_open < needed_total`, **push the shortfall to cards** (guarantee total).

3. `wantsToAllowLoans == true && imposeMaxLoanNumber == false`

   * `cards_to_open = ceil(revPctMinCards/100 × needed_total)`
   * `loans_to_open = needed_total - cards_to_open`

`alloc_headroom = cards_to_open + loans_to_open` (how many you still need overall).

---

## Step 5 — Timing gates (caps + intervals)

From `user_stocks_conso` and `user_hard_pulls`:

* `opens_in_365 = count(account DOFRecord in last 365 days)`
* `requests_in_180 = count(hard-pull DOFRecord in last 180 days)`
* `most_recent_open` = latest account DOFRecord (break ties by later time; if exact tie, prefer **card**)
* `most_recent_open.type` = card/loan by its `stock`
* `most_recent_request` = latest hard-pull DOFRecord

From `user_openAndCloseAdjustments (Type="Time")`:

* `yearly_cap = Yearly opens allowable`
* `halfyear_cap = Half-yearly requests allowable`
* `min_open_interval_months = Min interval between opens in LTM` (can be fractional)
* `min_request_interval_months = Min interval between requests in LTM` (can be fractional)

### Gate order (fail fast; any fail blocks)

1. **Caps:** if `opens_in_365 ≥ yearly_cap` or `requests_in_180 ≥ halfyear_cap` → **blocked**
2. **Intervals:** compute next permissible date from each interval:

   * `next_open_ok = most_recent_open + min_open_interval_months`
   * `next_request_ok = most_recent_request + min_request_interval_months`
     If **now** (NY time) is before either → **blocked**

> Fractional months are converted to calendar months + fractional days (~30.4375 × fraction).

### How many can open **now** (`slots_now`)

* If blocked or `alloc_headroom == 0` → `slots_now = 0`
* Else if **both intervals == 0** →
  `slots_now = min(alloc_headroom, yearly_cap headroom, halfyear_cap headroom)`
  (Allows multiple same-day opens up to caps.)
* Else (any interval > 0) →
  `slots_now = min(1, alloc_headroom, yearly headroom, half-year headroom)`
  (One at a time; cadence controlled by intervals.)

If `slots_now == 0`, also compute a conservative `next_eligible_date = max(next_open_ok, next_request_ok, cap windows)`.

**Assumption:** each open consumes **one** request (hard pull). Real multi-pull detection may lag by a monthly cycle; throttling addressed later.

---

## Step 6 — Type sequence for “now”

Produce up to `slots_now` items (“card”/“loan”) in order:

1. Start with the **opposite** of `most_recent_open.type` (to alternate).

   * If that bucket is disallowed or has no allocation left, start with the other.
2. Alternate thereafter: card → loan → card → …
3. If a bucket runs out (e.g., loans capped), keep filling with **cards** to guarantee total.

Result: `sequence_now = ["card","loan", ...]` with length = `slots_now`.

---

## Output (one doc per run) — `/user_open_actions_list`

Minimal but debuggable payload:

```json
{
  "userRef": <DocRef>,
  "created_time": <Timestamp>,
  "status": "proposed" | "blocked" | "done",

  "proposed": {
    "can_open_now": <bool>,
    "count_now": <number>,
    "sequence_now": ["card","loan", ...],
    "next_eligible_date": <Timestamp|null>,
    "cadence_months": {
      "opens_min_interval": <number>,
      "requests_min_interval": <number>
    }
  },

  "allocation": {
    "goal_total": <number>,
    "current_open_cards": <number>,
    "current_open_loans": <number>,
    "needed_total": <number>,
    "revPctMinCards": <number>,
    "loan_cap": <number|null>,
    "cards_to_open": <number>,
    "loans_to_open": <number>
  },

  "timing": {
    "opens_in_365": <number>,
    "requests_in_180": <number>,
    "most_recent_open": <Timestamp|null>,
    "most_recent_request": <Timestamp|null>,
    "yearly_opens_max": <number>,
    "halfyear_requests_max": <number>,
    "min_months_between_opens": <number>,
    "min_months_between_requests": <number>,
    "is_blocked_caps": <bool>,
    "is_blocked_intervals": <bool>,
    "block_reason": "<string|null>"
  },

  "selection_protocol": "alternate_by_most_recent_type",
  "notes": "User picks specific products from /user_card_recommendations; a separate CF writes origin docs post-approval."
}
```

---

## Edge cases & conventions

* If `needed_total == 0`, set `count_now = 0`, `status = "done"`.
* If `imposeMaxLoanNumber` binds hard, push unmet remainder to **cards** to guarantee total.
* If `most_recent_open` is null (no history), start `sequence_now` with **card** unless loans are required by allocation and allowed.
* Ties on `most_recent_open` at same millisecond → prefer **card** (as defined).
* Time basis: **America/New_York** for all “today/now” and calendar-month math.
