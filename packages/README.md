# Shared packages

Shared feature modules belong under this workspace boundary. `@orot/domain` defines provider-neutral health-record contracts and Zod validation.

The root `lint`, `typecheck`, and `test:unit` commands run both the mobile app checks and the domain package checks. The domain schemas require explicit effective, recorded, and ingested timestamps, provenance, and review state. `recordedAt` must not be later than `ingestedAt`; `effectiveAt` may be earlier for backfilled facts or later for scheduled appointments. Derived records identify their source records, and evidence spans identify the source record they quote.

Medication prescriptions, user-confirmed current medication, and dose events use separate discriminated contracts. These schemas validate record shape and provenance; they do not claim clinical correctness or confirm that referenced IDs exist in storage.
