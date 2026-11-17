import { NativeModules } from 'react-native';
import { saveReviewedVisitQuestions } from '../persistence';
import {
  appointment,
  evidenceSpan,
  sourceRecord,
  input,
  repository,
} from '../testing/persistenceFixtures';

declare const require: (specifier: string) => unknown;
const { createHash } = require('node:crypto') as {
  createHash(name: string): {
    update(text: string): { digest(encoding: string): string };
  };
};

afterEach(() => {
  delete NativeModules.OrotConsentFingerprint;
});

/** An async local digest cannot move the source validation before a mutation. */
test('a source changed while hashing is rejected by the original transaction fence', async () => {
  const store = repository({
    appointment: [appointment],
    source_record: [sourceRecord],
    evidence_span: [evidenceSpan],
  });
  let changed = false;
  NativeModules.OrotConsentFingerprint = {
    sha256: jest.fn(async (text: string) => {
      if (!changed) {
        changed = true;
        await store.service.transaction(async writer => {
          await writer.put('source_record', {
            ...sourceRecord,
            recordedAt: '2026-10-02T00:00:00Z',
            ingestedAt: '2026-10-02T00:00:00Z',
          } as never);
        });
      }
      return createHash('sha256').update(text).digest('hex');
    }),
  };
  await expect(
    saveReviewedVisitQuestions({ ...input(store), generationCaveats: [] }),
  ).rejects.toThrow(/changed|current/);
  expect(store.list('visit_question')).toEqual([]);
  expect(changed).toBe(true);
});
