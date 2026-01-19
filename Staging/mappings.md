# Staging Mapping Spec (v1) — `user_Staging_Accounts`

## Global rules

* `userRef`: always the current user doc ref.
* `stagingSource`:

  * `"origin_snapshot"` for CF2
  * `"report_upload"` for CF1
* `uploadID`:

  * CF1: set to provided uploadID
  * CF2: `""`
* `parserVersion`:

  * CF1: set (from reportUploads doc or constant)
  * CF2: `""`
* DocRef strings:

  * `originDocRef` and `lateOriginRef` stored as **string paths**
  * Use `"Irrelevant"` when not applicable
* `subStock` conventions:

  * inquiries: `"Inquiry"`
  * credit cards: `"Revolving"`
  * loans: `"Installment"`
  * collections: `"Collection"`
* `isCurrent`: **not relevant** for lates, collections, hard pulls (leave `null`)

---

# CF2 — Stage From Origin (Origin → Staging)

## CF2.A — `user_credit_cards` → staging (account)

| staging field      | value                                     |
| ------------------ | ----------------------------------------- |
| stock              | `"user_credit_cards"`                     |
| subStock           | `"Revolving"`                             |
| lender             | `card.lender`                             |
| name               | `card.commercialName`                     |
| isCFA              | `card.isCFA`                              |
| isAnnualFee        | `card.isAnnualFee`                        |
| isPaid             | `null`                                    |
| isCurrent          | `card.isCurrent`                          |
| severity           | `""`                                      |
| DOFRecord          | `card.dateIssued`                         |
| creditLimit        | `card.creditLimit`                        |
| amountsOwed        | `card.totalBalance`                       |
| isOpen             | `card.isOpen`                             |
| apr                | `card.apr`                                |
| interestRate       | `null` ✅                                  |
| originDocRef       | `"users/{uid}/user_credit_cards/{docId}"` |
| lateOriginRef      | `"Irrelevant"`                            |
| collections_agency | `""`                                      |

## CF2.B — `user_loans` → staging (account)

| staging field      | value                                                   |
| ------------------ | ------------------------------------------------------- |
| stock              | `"user_loans"`                                          |
| subStock           | `"Installment"`                                         |
| lender             | `loan.lender`                                           |
| name               | `loan.commercialName`                                   |
| isCFA              | `loan.isCFA`                                            |
| isAnnualFee        | `false`                                                 |
| isPaid             | `null`                                                  |
| isCurrent          | `loan.isCurrent`                                        |
| severity           | `""`                                                    |
| DOFRecord          | `loan.dateIssued`                                       |
| creditLimit        | `loan.principalOriginal` *(matches your conso pattern)* |
| amountsOwed        | `loan.balance`                                          |
| isOpen             | `loan.isOpen`                                           |
| apr                | `loan.apr` ✅                                            |
| interestRate       | `null` ✅                                                |
| originDocRef       | `"users/{uid}/user_loans/{docId}"`                      |
| lateOriginRef      | `"Irrelevant"`                                          |
| collections_agency | `""`                                                    |

## CF2.C — `user_credit_cards_late_payments` → staging (late)

| staging field       | value                                                       |
| ------------------- | ----------------------------------------------------------- |
| stock               | `"user_credit_cards_late_payments"`                         |
| subStock            | `"Revolving"`                                               |
| lender/name         | join `late.cardRef` → card.lender / card.commercialName     |
| isCFA / isAnnualFee | optional from joined card                                   |
| isPaid              | `late.isPaid`                                               |
| isCurrent           | `null` ✅                                                    |
| severity            | `late.severity` *(leave as stored today)*                   |
| DOFRecord           | `late.DOFD`                                                 |
| amountsOwed         | `late.amount`                                               |
| creditLimit         | `null`                                                      |
| isOpen              | `null`                                                      |
| apr / interestRate  | `null`                                                      |
| originDocRef        | `"users/{uid}/user_credit_cards/{cardDocId}"`               |
| lateOriginRef       | `"users/{uid}/user_credit_cards_late_payments/{lateDocId}"` |
| collections_agency  | `""`                                                        |

## CF2.D — `user_loans_late_payments` → staging (late)

Same as C but join via `late.loanRef`:

| staging field      | value                                                |
| ------------------ | ---------------------------------------------------- |
| stock              | `"user_loans_late_payments"`                         |
| subStock           | `"Installment"`                                      |
| lender/name        | join loanRef → loan.lender / loan.commercialName     |
| isPaid             | `late.isPaid`                                        |
| isCurrent          | `null` ✅                                             |
| severity           | `late.severity`                                      |
| DOFRecord          | `late.DOFD`                                          |
| amountsOwed        | `late.amount`                                        |
| originDocRef       | `"users/{uid}/user_loans/{loanDocId}"`               |
| lateOriginRef      | `"users/{uid}/user_loans_late_payments/{lateDocId}"` |
| collections_agency | `""`                                                 |

## CF2.E — `user_collections_3rd_party` → staging (collection)

| staging field      | value                                              |
| ------------------ | -------------------------------------------------- |
| stock              | `"user_collections_3rd_party"`                     |
| subStock           | `"Collection"`                                     |
| lender             | `collection.originalProvider` ✅                    |
| collections_agency | `collection.collectionsAgency` ✅                   |
| name               | `collection.name` (fallback originalProvider)      |
| isPaid             | `collection.isPaid`                                |
| isCurrent          | `null` ✅                                           |
| severity           | `"Collection"`                                     |
| DOFRecord          | `collection.DOFD`                                  |
| amountsOwed        | `collection.amount`                                |
| originDocRef       | `"users/{uid}/user_collections_3rd_party/{docId}"` |
| lateOriginRef      | `"Irrelevant"`                                     |

## CF2.F — `user_hard_pulls` → staging (inquiry)

| staging field      | value                                   |
| ------------------ | --------------------------------------- |
| stock              | `"hard_pull"` ✅                         |
| subStock           | `"Inquiry"` ✅                           |
| lender             | `hp.lender`                             |
| name               | `hp.productName`                        |
| isCurrent          | `null` ✅                                |
| DOFRecord          | `hp.dateOfRequest`                      |
| originDocRef       | `"users/{uid}/user_hard_pulls/{docId}"` |
| lateOriginRef      | `"Irrelevant"`                          |
| collections_agency | `""`                                    |

---

# CF1 — Stage From Upload (Parsed Snapshot → Staging)

General:

* `stagingSource = "report_upload"`
* `uploadID = uploadId`
* `originDocRef = ""` for all staged-from-upload docs (until later matching logic fills it)

## CF1.A — snapshot `recordType:"account"` → staging (account)

| staging field      | value                                                 |
| ------------------ | ----------------------------------------------------- |
| stock              | from `loanType`, mapped to origin-collection format ✅ |
|                    | `"Credit Card" -> "user_credit_cards"`                |
|                    | otherwise -> `"user_loans"`                           |
| subStock           | `"Revolving"` if credit card else `"Installment"`     |
| lender             | `snap.lender` (fallback snap.companyName)             |
| name               | `snap.companyName`                                    |
| DOFRecord          | `snap.openDate`                                       |
| creditLimit        | `snap.creditLimit`                                    |
| amountsOwed        | `snap.balance`                                        |
| isOpen             | `snap.closedDate == null ? true : false` ✅            |
| isCurrent          | `null` *(do later with severity/late logic)* ✅        |
| isCFA              | `false` ✅                                             |
| isAnnualFee        | `false` ✅                                             |
| apr                | `0` ✅                                                 |
| interestRate       | `null`                                                |
| severity           | `""`                                                  |
| lateOriginRef      | `"Irrelevant"`                                        |
| collections_agency | `""`                                                  |

## CF1.B — snapshot `recordType:"collection"` → staging (NOT NORMALIZED YET)

**Decision:** parser doesn’t emit a stable schema yet → user will enter directly in UI.

So CF1 will either:

* skip these docs entirely for now, OR
* stage them with minimal placeholders and rely on UI edits

(We’ll choose one when implementing CF1.)

## CF1.C — snapshot `recordType:"inquiry"` → staging (inquiry)

| staging field      | value              |
| ------------------ | ------------------ |
| stock              | `"hard_pull"` ✅    |
| subStock           | `"Inquiry"` ✅      |
| lender             | `snap.lender`      |
| name               | `snap.lender`      |
| DOFRecord          | `snap.inquiryDate` |
| isCurrent          | `null`             |
| severity           | `""`               |
| originDocRef       | `""`               |
| lateOriginRef      | `"Irrelevant"`     |
| collections_agency | `""`               |

## CF1.D — snapshot `recordType:"public_record"` → staging (NOT NORMALIZED YET)

Same as collections: no stable schema from parser yet → user will enter directly in UI.

Absolutely — here’s the **drop-in section** you can append to your existing `mappings.md` (same style, same conventions), reflecting the final agreed **Upload → Staging late extraction** rules, including your updated severity logic + the new `lateDisambiguousParentAccountString`. 

## CF1.E — snapshot `recordType:"account"` → staging (lates derived from paymentHistory)

**Goal:** Each account snapshot can produce **0..N late docs**.
A “late doc” is created **once per contiguous sequence** of negative codes.
**3 consecutive months of late marking = 1 late doc.**

### Legend codes (classification)

**Good**

* `OK`

**Neutral (does not start a late by itself)**

* `NR` (Not Reported)
* `UN` (Unknown)
* `D` (Dispute)

**Not-open / boundary**

* `NO` (Not Open) → treat as neutral, but it also **ends** an active late sequence if encountered.

**Negative (starts/continues a late sequence)**

* `CO` (ChargeOff/Other Derogatory)
* `FC` (Foreclosure)
* `PP` (Payment Plan)
* `# Days Late`:

  * either explicit numeric days (e.g. `30`, `60`, `90`…) **OR**
  * may appear as just `#` (unknown days)

### Event segmentation rule

Scan the monthly payment history in chronological order:

* Start an event when entering a **Negative** month from a non-negative month.
* Continue while months remain **Negative**.
* End event when the first non-negative code appears (`OK`, `NR`, `UN`, `D`, `NO`, or end-of-history).
* Write **1 staging late doc per event**.

### isPaid

For each late event:

* `isPaid = true` **only if** the first month after the sequence ends is `OK`
* otherwise `isPaid = false`

*(Leave `isCurrent = null` for all late docs.)*

### severity (final agreed logic)

For each late event:

1. If the event contains any explicit numeric days-late values (e.g. `30`, `60`, `90`):

   * `severity = max(numericDaysLateInEvent)` as a string

2. Else if the event uses only the generic `#` marker (no numeric days):

   * `severity = 30 * (count of consecutive "#" months in that event)` as a string
     (e.g. `###` → `"90"`)

3. Else (no numeric days and no `#`), use other negative event types:

   * if event contains `CO` → `"CO"`
   * else if contains `FC` → `"FC"`
   * else if contains `PP` → `"PP"`
   * else `"unknown"`

### lateDisambiguousParentAccountString (NEW FIELD)

For every **late doc only**:

* `lateDisambiguousParentAccountString = lender + "|" + accountNumber + "|" + openDate + "|" + loanType`

Where:

* `lender` = from snapshot account
* `accountNumber` = from snapshot if available; else `""`
* `openDate` = snapshot openDate (stringified consistently)
* `loanType` = snapshot loanType

For all non-late staging docs: `lateDisambiguousParentAccountString = null`.

### Late doc mapping (Upload → Staging)

| staging field                       | value                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| stock                               | based on parent loanType: credit card → `"user_credit_cards_late_payments"`, else → `"user_loans_late_payments"` |
| subStock                            | credit card → `"Revolving"`, else → `"Installment"`                                                              |
| lender                              | parent snapshot lender                                                                                           |
| name                                | parent snapshot companyName                                                                                      |
| DOFRecord                           | **start month** of the late event (first negative month)                                                         |
| severity                            | per rules above                                                                                                  |
| isPaid                              | per rules above                                                                                                  |
| isCurrent                           | `null`                                                                                                           |
| amountsOwed                         | `0` *(user inputs in UI)*                                                                                        |
| creditLimit                         | `null`                                                                                                           |
| isOpen                              | `null`                                                                                                           |
| apr                                 | `0`                                                                                                              |
| interestRate                        | `null`                                                                                                           |
| isCFA                               | `false`                                                                                                          |
| isAnnualFee                         | `false`                                                                                                          |
| originDocRef                        | `""`                                                                                                             |
| lateOriginRef                       | `"Irrelevant"`                                                                                                   |
| collections_agency                  | `""`                                                                                                             |
| lateDisambiguousParentAccountString | as defined above                                                                                                 |
| stagingSource                       | `"report_upload"`                                                                                                |
| uploadID                            | `uploadId`                                                                                                       |
| parserVersion                       | from reportUploads doc or constant                                                                               |


