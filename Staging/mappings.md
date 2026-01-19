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
