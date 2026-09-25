# Contract scope non-disclosure hotfix

## Verified behavior

Contract writes distinguish two cases:

- A project hidden from the caller's contract scope returns `404 CONTRACT_PROJECT_NOT_FOUND`, preventing ID probing from confirming another entity's project exists.
- A project visible through an authorized subcontract relationship, but owned by a different responsible entity, returns `403 CONTRACT_PROJECT_WRITE_FORBIDDEN`; the caller may read the relationship but may not edit the owner entity's project.

The write guard first resolves the project through the same scoped visibility predicate used by contract listing/details, then checks responsible-entity write authority. This avoids both existence leaks and accidental read/write privilege escalation.

## Regression coverage

- `smoke-contracts-e2e.mts`: a wholly out-of-scope project PATCH returns 404, while a subcontractor organization that can view a related project but does not own it receives 403.
- `smoke-baseline-qa-access.mts`: six out-of-scope write probes against the test-site synthetic contracts must each return 404.

No schema, migration, grant model, or historical contract data is changed.
