# Organization policy checks

Run `infra/check-org-policies.sh` (read-only) against the real project and record the verdict here before go-live. Status: **pending live project** (no policy has been read yet).

| Constraint                             | Why it matters                                               | Blocks the design if    | Verdict   | Decision / exception (who, when)                                                                                 |
| -------------------------------------- | ------------------------------------------------------------ | ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `storage.publicAccessPrevention`       | Public PDF bucket (ADR 0005) needs `allUsers` object readers | enforced                | _pending_ | If enforced: request an exception for the PDF bucket project/folder; fall back is signed URLs (changes ADR 0005) |
| `iam.allowedPolicyMemberDomains`       | `allUsers` on the PDF bucket and on Cloud Run invoker        | restricts to own domain | _pending_ | Exception needed for the PDF bucket and `certificates-api` (Hosting reaches it unauthenticated)                  |
| `iam.disableServiceAccountKeyCreation` | No keys are used by design                                   | never blocks            | _pending_ | Enforced is welcome; nothing to do                                                                               |
| `gcp.resourceLocations`                | Everything in `us-east1` (ADR 0014)                          | `us-east1` not allowed  | _pending_ | Request `in:us-east1-locations` or `in:us-locations`                                                             |
| `run.requireInvokerIam` (extra)        | Hosting rewrite needs a public Cloud Run invoker             | enforced                | _pending_ | Same exception as above, or front the API differently                                                            |

If any row blocks, the exception request, approver and date are recorded in the last column **before go-live**; if none block, write "no blocking policy found" with the date and who ran the check.
