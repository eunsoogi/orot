import { committedActionReceiptMatches } from '../src/multiAgent/committedActionReceipt';

test('a committed identity cannot be substituted across run, call or action contract', () => {
  const expected = {
    operationRunId: 'run',
    operationKey: 'tool-1',
    toolId: 'save',
    toolVersion: '2',
    evidenceReferences: [],
  };
  // Empty evidence never proves a committed domain result, even with otherwise matching identity.
  expect(committedActionReceiptMatches({ version: 1, ...expected }, expected)).toBe(false);
  for (const value of [
    null,
    [],
    {},
    { version: 1 },
    { version: 1, ...expected, operationKey: 'tool-0' },
  ]) {
    expect(committedActionReceiptMatches(value, expected)).toBe(false);
  }
});

test('matches exact nonempty receipt but rejects identity and revision substitutions', () => {
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId: 'entry',
    sourceRevision: 'r1',
    evidenceId: 'entry',
    evidenceRevision: 'r1',
    locator: { entryId: 'entry' },
    effectiveTime: null,
    reviewState: 'unreviewed' as const,
  };
  const expected = {
    operationRunId: 'run',
    operationKey: 'tool-1',
    toolId: 'save',
    toolVersion: '2',
    evidenceReferences: [reference],
  };
  const receipt = { version: 1, ...expected };
  expect(committedActionReceiptMatches(receipt, expected)).toBe(true);
  for (const patch of [
    { operationRunId: 'other' },
    { operationKey: 'tool-2' },
    { toolId: 'other' },
    { toolVersion: '3' },
    { evidenceReferences: [{ ...reference, sourceRevision: 'r2' }] },
    { evidenceReferences: [] },
  ])
    expect(committedActionReceiptMatches({ ...receipt, ...patch }, expected)).toBe(false);
});
