import { staleEvidenceDiagnostic } from '../staleEvidenceDiagnostic';

test.each([
  [
    'Evidence changed while the model request was in progress.',
    'stale_model_boundary',
  ],
  [
    'The conversation stream could not be prepared safely.',
    'stale_preview_boundary',
  ],
  [
    'The conversation stream input changed during preparation.',
    'stale_preview_input',
  ],
  [
    'The conversation input could not be prepared safely.',
    'stale_search_boundary',
  ],
  [
    'The allowlisted evidence search did not produce valid current evidence.',
    'stale_search_result',
  ],
  [
    'One or more evidence sources changed during the run.',
    'stale_combined_evidence',
  ],
  ['Evidence freshness could not be confirmed.', 'stale_evidence_unavailable'],
  [
    'Initial evidence was no longer current at run start.',
    'stale_initial_evidence',
  ],
  [
    'The saved run cannot be safely resumed; start a fresh run.',
    'stale_resume',
  ],
])('maps only the exact runtime reason %s', (reason, token) => {
  expect(staleEvidenceDiagnostic(reason)).toBe(token);
  expect(staleEvidenceDiagnostic(reason + ' synthetic private value')).toBe(
    'other',
  );
});
test.each([undefined, 'synthetic private text', '__proto__', 'constructor'])(
  'drops unknown values',
  reason => {
    expect(staleEvidenceDiagnostic(reason)).toBe('other');
  },
);
