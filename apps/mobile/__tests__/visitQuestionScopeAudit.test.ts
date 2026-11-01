import type { Appointment } from '@orot/domain';
import { auditVisitQuestionScope } from '../e2e/visitQuestionScopeAudit';
import type { ScopeSnapshot } from '../e2e/visitQuestionScopeAudit';
import {
  acceptEmptyHealthBatch,
  acceptScopeContext,
  acceptScopeEvidence,
  beginScopeObservation,
  dispatchScoped,
  expectedSymptom,
  observedEvidenceCount,
  providerEvidenceCount,
  rejectScope,
  requireScopeContext,
  scopeRejection,
} from '../e2e/visitQuestionScopeGuard';
import { visitQuestionCitationKey } from '../src/agent/visitQuestions/evidence';

const appointment = {
  id: 'synthetic-appointment',
  calendarEventIdentifier: 'synthetic-event',
} as Appointment;
const snapshot: ScopeSnapshot = {
  appointments: [appointment],
  symptomIds: ['synthetic-symptom'],
  otherCounts: { transcript: 0, health: 0 },
  memorySourceIds: [] as string[][],
};
const audit = (value = snapshot, selected = appointment) =>
  auditVisitQuestionScope(
    value,
    selected,
    'synthetic-event',
    'synthetic-symptom',
  );

test('accepts only the confirmed fixture sources', () => {
  expect(audit().ok).toBe(true);
  expect(
    audit({ ...snapshot, memorySourceIds: [['synthetic-symptom']] }).ok,
  ).toBe(false);
});

test('rejects changed appointments, evidence, and unknown memory provenance', () => {
  expect(audit(snapshot, { ...appointment, id: 'other' }).ok).toBe(false);
  expect(audit({ ...snapshot, symptomIds: ['other'] }).ok).toBe(false);
  expect(audit({ ...snapshot, otherCounts: { transcript: 1 } }).ok).toBe(false);
  expect(audit({ ...snapshot, memorySourceIds: [[]] }).ok).toBe(false);
  expect(audit({ ...snapshot, memorySourceIds: [['other']] }).ok).toBe(false);
});

test('requires the instrumented context and audits actual tool evidence before release', () => {
  const report = jest.fn();
  const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const token = beginScopeObservation(report);
  expect(() => requireScopeContext(token)).toThrow();
  acceptScopeContext(token);
  expect(() => requireScopeContext(token)).not.toThrow();
  const item = {
    sourceKind: 'personal_record',
    sourceId: expectedSymptom,
    sourceRevision: 'r',
    evidenceId: expectedSymptom,
    evidenceRevision: 'r',
    locator: { kind: 'structured_record', recordId: expectedSymptom },
    effectiveTime: null,
    reviewState: 'unreviewed',
    content: 'synthetic',
  } as const;
  const metadata = {
    recordKind: 'symptom_entry',
    evidenceRecordId: expectedSymptom,
    sourceRecordIds: [expectedSymptom],
  };
  const collection = {
    batch: { items: [item] },
    metadataByCitation: new Map([[visitQuestionCitationKey(item), metadata]]),
  } as never;
  acceptScopeEvidence(token, collection);
  acceptScopeEvidence(token, collection);
  expect(observedEvidenceCount(token)).toBe(1);
  expect(
    providerEvidenceCount(token, {
      messages: [
        {
          role: 'user',
          content: 'Available evidence: [{"evidenceId":"evidence-1"}]',
        },
      ],
    }),
  ).toBe(1);
  expect(() =>
    providerEvidenceCount(token, {
      messages: [
        {
          role: 'tool',
          toolCallId: 't',
          result: { evidenceIds: ['evidence-2'] },
        },
      ],
    }),
  ).toThrow();
  const unexpected = { ...item, evidenceId: 'other' };
  expect(() =>
    acceptScopeEvidence(token, {
      batch: { items: [unexpected] },
      metadataByCitation: new Map([
        [visitQuestionCitationKey(unexpected), metadata],
      ]),
    } as never),
  ).toThrow();
  expect(() => acceptEmptyHealthBatch(token, 1)).toThrow();
  expect(report).toHaveBeenCalledWith(
    '{"scopeRejected":"aggregate_unconfirmed"}',
  );
  expect(log).toHaveBeenCalledWith(
    'OROT_SYNTHETIC_SCOPE_REJECT aggregate_unconfirmed',
  );
  expect(scopeRejection(token)).toBe('aggregate_unconfirmed');
  beginScopeObservation(jest.fn());
  expect(() => requireScopeContext(token)).toThrow();
  expect(() => acceptScopeContext(token)).toThrow();
  log.mockRestore();
});

test('does not dispatch to the real provider when scope is unavailable or rejected', async () => {
  const send = jest.fn(async () => 'sent');
  const token = beginScopeObservation(jest.fn());
  await expect(
    dispatchScoped(token, async () => undefined, send),
  ).rejects.toThrow();
  acceptScopeContext(token);
  await expect(
    dispatchScoped(
      token,
      async () => {
        throw new Error('mismatch');
      },
      send,
    ),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  await expect(
    dispatchScoped(token, async () => undefined, send),
  ).resolves.toBe('sent');
  expect(send).toHaveBeenCalledTimes(1);
});

test('a newer generation prevents an older pending dispatch', async () => {
  const old = beginScopeObservation(jest.fn());
  acceptScopeContext(old);
  let resume!: () => void;
  const send = jest.fn(async () => 'sent');
  const pending = dispatchScoped(
    old,
    () =>
      new Promise<void>(resolve => {
        resume = resolve;
      }),
    send,
  );
  const newerReport = jest.fn();
  const newer = beginScopeObservation(newerReport);
  resume();
  await expect(pending).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(newerReport).not.toHaveBeenCalled();
  expect(scopeRejection(newer)).toBeNull();
  expect(() => rejectScope(old, 'inventory_unavailable')).toThrow();
  expect(newerReport).not.toHaveBeenCalled();
  expect(scopeRejection(newer)).toBeNull();
});

test('diagnostic resolver substitutes only the visit route context loader', () => {
  const config = require('../e2e/visit-question-scope.metro.config');
  const result = config.resolver.resolveRequest(
    {
      originModulePath:
        '/app/src/aiFeatures/integration/visitQuestionsRouteOperations.ts',
    },
    './visitQuestionsContextLoader',
    'ios',
  );
  expect(result.type).toBe('sourceFile');
  expect(result.filePath).toMatch(/visitQuestionScopeContext\.ts$/u);
});
