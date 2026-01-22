# MAPPINGS — StAGING ↔ ORIGIN ↔ UPLOAD

**(Canonical Spec — Updated with `accountNumber`)**

---

## Global Rules

* **Staging is the only editable surface**
* **Origin collections are the system of record**
* **CF1**: Upload snapshot → Staging
* **CF2**: Origin snapshot → Staging
* **CF3**: Staging → Origin (commit + delta logs)

### Global Fields

```md
userRef: DocRef(users)
stock: String
subStock: String
accountNumber: String
originDocRef: String
lateOriginRef: String
stagingSource: String
uploadID: String
parserVersion: String
```

### accountNumber (NEW — GLOBAL)

```md
accountNumber:
- String
- Present on all account-level records (cards, loans, lates)
- Used to match upload/staging records to origin records in CF3
- May be masked or partial (e.g. last 4 digits)
- May be empty string "" if unavailable
- Never user-editable once committed to origin
```

---

## CF2 — Stage From Origin (Origin → Staging)

### CF2.A — `user_credit_cards` → staging (account)

| field              | value                                     |
| ------------------ | ----------------------------------------- |
| stock              | `"user_credit_cards"`                     |
| subStock           | `"Revolving"`                             |
| lender             | `card.lender`                             |
| name               | `card.commercialName`                     |
| accountNumber      | `card.accountNumber`                      |
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
| interestRate       | `null`                                    |
| originDocRef       | `"users/{uid}/user_credit_cards/{docId}"` |
| lateOriginRef      | `"Irrelevant"`                            |
| collections_agency | `""`                                      |
| stagingSource      | `"origin_snapshot"`                       |
| uploadID           | `""`                                      |
| parserVersion      | `""`                                      |

---

### CF2.B — `user_loans` → staging (account)

| field              | value                              |
| ------------------ | ---------------------------------- |
| stock              | `"user_loans"`                     |
| subStock           | `"Installment"`                    |
| lender             | `loan.lender`                      |
| name               | `loan.commercialName`              |
| accountNumber      | `loan.accountNumber`               |
| isCFA              | `loan.isCFA`                       |
| isAnnualFee        | `false`                            |
| isPaid             | `null`                             |
| isCurrent          | `loan.isCurrent`                   |
| severity           | `""`                               |
| DOFRecord          | `loan.dateIssued`                  |
| creditLimit        | `loan.principalOriginal`           |
| amountsOwed        | `loan.balance`                     |
| isOpen             | `loan.isOpen`                      |
| apr                | `loan.apr`                         |
| interestRate       | `null`                             |
| originDocRef       | `"users/{uid}/user_loans/{docId}"` |
| lateOriginRef      | `"Irrelevant"`                     |
| collections_agency | `""`                               |
| stagingSource      | `"origin_snapshot"`                |

---

### CF2.C / CF2.D — Lates from origin

| field         | value                            |
| ------------- | -------------------------------- |
| stock         | late collection                  |
| subStock      | `"Revolving"` or `"Installment"` |
| lender        | parent account lender            |
| name          | parent account name              |
| accountNumber | inherited from parent account    |
| DOFRecord     | `late.DOFD`                      |
| severity      | `late.severity`                  |
| isPaid        | `late.isPaid`                    |
| isCurrent     | `null`                           |
| amountsOwed   | `late.amount`                    |
| originDocRef  | parent account ref               |
| lateOriginRef | late doc ref                     |
| stagingSource | `"origin_snapshot"`              |

---

### CF2.E — `user_collections_3rd_party`

| field              | value                          |
| ------------------ | ------------------------------ |
| stock              | `"user_collections_3rd_party"` |
| subStock           | `"Collection"`                 |
| lender             | original creditor              |
| name               | original creditor              |
| collections_agency | agency                         |
| DOFRecord          | DOFD                           |
| amountsOwed        | amount                         |
| isPaid             | boolean                        |
| severity           | `"Collection"`                 |
| originDocRef       | collection doc ref             |
| stagingSource      | `"origin_snapshot"`            |

---

### CF2.F — `user_hard_pulls`

| field         | value               |
| ------------- | ------------------- |
| stock         | `"hard_pull"`       |
| subStock      | `"Inquiry"`         |
| lender        | hp.lender           |
| name          | hp.productName      |
| DOFRecord     | hp.dateOfRequest    |
| originDocRef  | hp doc ref          |
| stagingSource | `"origin_snapshot"` |

---

## CF1 — Stage From Upload (Upload → Staging)

### CF1.A — snapshot `recordType:"account"`

| field         | value                                   |
| ------------- | --------------------------------------- |
| stock         | `"user_credit_cards"` or `"user_loans"` |
| subStock      | `"Revolving"` or `"Installment"`        |
| lender        | snapshot lender                         |
| name          | snapshot companyName                    |
| accountNumber | snapshot accountNumber or `""`          |
| DOFRecord     | snapshot openDate                       |
| creditLimit   | snapshot creditLimit                    |
| amountsOwed   | snapshot balance                        |
| isOpen        | `closedDate == null`                    |
| isCFA         | `false`                                 |
| isAnnualFee   | `false`                                 |
| apr           | `0`                                     |
| interestRate  | `null`                                  |
| isCurrent     | `null`                                  |
| originDocRef  | `""`                                    |
| lateOriginRef | `"Irrelevant"`                          |
| stagingSource | `"report_upload"`                       |
| uploadID      | uploadId                                |
| parserVersion | parserVersion                           |

---

### CF1.E — Lates derived from `paymentHistory`

#### Codes (authoritative)

* OK
* NR
* 30 / 60 / 90 / 120 / 150 / 180
* CO

#### Event Rule

* Consecutive negative months = **1 late**
* Separate sequences = separate lates

#### severity

* numeric present → `max(code)`
* else if CO → `"CO"`

#### isPaid

* `true` if first post-event month is `OK`
* else `false`

#### DOFRecord

* first month of the late sequence

#### lateDisambiguousParentAccountString

```md
lender + "|" + accountNumber + "|" + openDate + "|" + loanType
```

#### Late staging doc fields

| field         | value                                                               |
| ------------- | ------------------------------------------------------------------- |
| stock         | `"user_credit_cards_late_payments"` or `"user_loans_late_payments"` |
| subStock      | `"Revolving"` or `"Installment"`                                    |
| lender        | parent lender                                                       |
| name          | parent name                                                         |
| accountNumber | parent accountNumber                                                |
| DOFRecord     | event start                                                         |
| severity      | derived                                                             |
| isPaid        | derived                                                             |
| isCurrent     | `null`                                                              |
| amountsOwed   | `0`                                                                 |
| originDocRef  | `""`                                                                |
| lateOriginRef | `"Irrelevant"`                                                      |
| stagingSource | `"report_upload"`                                                   |

---

## CF3 — Commit Staging → Origin (Assumptions)

### Matching priority when `originDocRef` is empty

1. `accountNumber + stock + userRef`
2. fallback: `lender + openDate + loanType`
3. else CREATE

### Creation rule

* Persist `accountNumber` exactly as received

### Null rule

* Fields absent in staging → **do not touch origin**
