# Budget alerts

Spec §12: set the budget alerts **before** any other resource exists. `infra/02-budget.sh` creates two monthly budgets scoped to the project, `cert-manager-1usd` and `cert-manager-5usd`, each alerting at 50 %, 90 % and 100 % of its amount (so at $0.50, $0.90, $1, $2.50, $4.50 and $5). Alerts go to the billing account administrators (Cloud Billing default) and to the Cloud Monitoring email channels created from `BUDGET_EMAILS`, which must hold at least two humans.

Budgets alert only; they never stop spending. Reaction steps will be in `docs/cost-model.md` ("If a quota is exceeded").

## Prerequisites

A person with _Billing Account Administrator_ on the university billing account runs `infra/01-project.sh` and `infra/02-budget.sh` (see `infra/README.md`).

## Verifying that alerts arrive

Acceptance of BEU-ICT/certificate-manager#266 requires evidence that both recipients get mail:

1. In the console, Billing -> Budgets & alerts -> the budget -> _Manage notifications_, or temporarily edit the budget to `$0.01`; spend of fractions of a cent triggers the alert within about a day.
2. In Monitoring -> Alerting -> Notification channels, press _Send test notification_ on each channel (this checks channel delivery immediately).
3. Record who received the mail and when in the table below, then restore the budget amounts by re-running `02-budget.sh` after deleting the changed budget.

| Date                   | Recipient | Result |
| ---------------------- | --------- | ------ |
| _pending live project_ |           |        |

## Who receives billing emails

Billing administrators of the billing account (university) and the people in `BUDGET_EMAILS`. Record the actual names in the private operator notes, not in this repository.
