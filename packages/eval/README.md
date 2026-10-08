# @orot/eval

`@orot/eval` creates deterministic synthetic health-record fixtures for retrieval, agent, safety, and provider evaluations. Pass an opaque seed to `createSyntheticHealthFixture(seed)`: the same seed produces the same fixture and IDs, while a different seed gives the same scenarios a separate ID namespace.

```ts
import { createSyntheticHealthFixture } from '@orot/eval';

const fixture = createSyntheticHealthFixture('evaluation-run-01');
```

The fixture covers encounters, transcript revisions, medication assertions and dose history, blood pressure, sleep in different units, symptoms, appointments, and intentional conflicts. Each evaluation case names expected evidence by source-record and evidence-span IDs, including missing evidence, and records whether clarification is required plus safety constraints such as not inferring current medication from an old prescription.

All records, labels, values, and dates are synthetic. The data contain no personal health information and have not been clinically validated. They are only test inputs and expected evaluation outcomes; they must not be used as patient records, diagnoses, or treatment guidance. The seed is an ID namespace, not a way to generate clinically meaningful variation.

Run the package through the root `pnpm lint`, `pnpm typecheck`, and `pnpm test:unit` commands.

The seeded visit-question fixtures and LangSmith-safe evaluators are described in [the visit-question evaluation guide](../../docs/evaluation/visit-questions.md). The manual graph runner defaults to the clearly labeled test adapter. It can select an evaluation-only OpenAI API provider after explicit synthetic remote-processing consent; this path reports only token counts returned by every real API response and does not estimate missing usage.
