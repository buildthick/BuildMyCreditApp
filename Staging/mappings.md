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

Absolutely — here is the **clean, final, authoritative rewrite** of **CF1.E** that you can **paste directly into `mappings.md`**. This version reflects the *actual observed report codes* and removes all earlier speculation.

## CF1.E — snapshot `recordType:"account"` → staging

### (lates derived from `paymentHistory`)

**Goal:**
Each account snapshot can produce **0..N late staging docs**.
A **late staging doc represents one contiguous late event**, regardless of how many months it spans.

> **Important invariant:**
> **Consecutive late months = 1 late**
> Separate late sequences = separate late docs

---

### Payment history codes (authoritative)

Observed in real reports:

**Good**

* `OK`

**Neutral**

* `NR` (Not Reported)

**Negative (late / derogatory)**

* `30`
* `60`
* `90`
* `120`
* `150`
* `180`
* `CO` (Charge-Off)

There is **no generic `#` code** in practice.

---

### Late event segmentation

Scan the account’s `paymentHistory` **chronologically** (oldest → newest):

1. **Start a late event** when a month contains any **Negative** code.
2. **Continue the same event** while subsequent months remain Negative.
3. **End the event** when a month becomes:

   * `OK`, or
   * `NR`, or
   * end of history.
4. **Write exactly one staging late doc per event.**

Example:

```
OK → OK → 30 → 60 → OK → OK
```

→ **1 late doc** (severity `60`)

---

### severity

For each late event:

* If numeric codes appear (`30–180`):
  → `severity = max(numericCodeInEvent)` (as string)

* Else if `CO` appears:
  → `severity = "CO"`

---

### isPaid

For each late event:

* `isPaid = true` **only if** the **first month after the event** is `OK`
* Otherwise `isPaid = false`

> `isCurrent` is **not used** for late docs.

---

### DOFRecord

* `DOFRecord` = **first month of the late event**
  (the month where the first negative code appears)

---

### lateDisambiguousParentAccountString

For every **late staging doc only**, set:

```
lateDisambiguousParentAccountString =
  lender + "|" + accountNumber + "|" + openDate + "|" + loanType
```

Where:

* `lender` = snapshot account lender
* `accountNumber` = snapshot account number if available, else `""`
* `openDate` = snapshot openDate (stringified consistently)
* `loanType` = snapshot loanType

For all **non-late staging docs**:
`lateDisambiguousParentAccountString = null`

---

### Late staging doc mapping (Upload → Staging)

| staging field                       | value                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| stock                               | credit card → `"user_credit_cards_late_payments"`<br>loan → `"user_loans_late_payments"` |
| subStock                            | credit card → `"Revolving"`<br>loan → `"Installment"`                                    |
| lender                              | parent snapshot lender                                                                   |
| name                                | parent snapshot companyName                                                              |
| DOFRecord                           | start month of the late event                                                            |
| severity                            | per rules above                                                                          |
| isPaid                              | per rules above                                                                          |
| isCurrent                           | `null`                                                                                   |
| amountsOwed                         | `0` *(user inputs via UI)*                                                               |
| creditLimit                         | `null`                                                                                   |
| isOpen                              | `null`                                                                                   |
| apr                                 | `0`                                                                                      |
| interestRate                        | `null`                                                                                   |
| isCFA                               | `false`                                                                                  |
| isAnnualFee                         | `false`                                                                                  |
| originDocRef                        | `""`                                                                                     |
| lateOriginRef                       | `"Irrelevant"`                                                                           |
| collections_agency                  | `""`                                                                                     |
| lateDisambiguousParentAccountString | as defined above                                                                         |
| stagingSource                       | `"report_upload"`                                                                        |
| uploadID                            | `uploadId`                                                                               |
| parserVersion                       | from `reportUploads/{uploadId}` or constant                                              |

---

This section is now **fully aligned with real report data**, internally consistent with the rest of `mappings.md`, and safe to treat as **final for CF1 implementation**.

If you want, next we can:

* sanity-check this against one real parsed `paymentHistory` object shape, or
* move straight into **CF1 pseudocode / helper function design** in the new thread.
