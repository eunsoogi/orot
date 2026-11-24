import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { guardSelectedRecordingProvider } from '../selectedRecordingProvider';
import { proveSelectedRecordingTimestamp } from '../selectedRecordingTimestampProof';
import {
  chosen,
  other,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

const timestamp = '2090-01-01T00:10:00.000Z';
const later = '2090-01-03T00:10:00.000Z';
const request: LanguageModelRequest = {
  messages: [{ role: 'user', content: 'Synthetic request' }],
};

it.each([
  ['generate', 'valid'],
  ['generate', 'selected-edited'],
  ['generate', 'new-collision'],
  ['generate', 'queued-collision'],
  ['generate', 'native-locked'],
  ['generate', 'payload-mismatch'],
  ['stream', 'valid'],
  ['stream', 'new-collision'],
] as const)(
  '%s rejects stale dispatch or hands off once (%s)',
  (method, state) =>
    withRecordings(
      async (_data, _edit, _storage, database) => {
        async function time(id: string, column: string, body = column) {
          await database.execute(
            "UPDATE source_records SET recorded_at=?, payload_json=json_set(payload_json,'$.recordedAt',?) WHERE id=?",
            [column, body, id],
          );
        }
        await time(other, later);
        if (state === 'payload-mismatch') await time(chosen, timestamp, later);
        let held = false;
        let queuedMutation: Promise<unknown> | undefined;
        const hold = async () => {
          const out = await proveSelectedRecordingTimestamp({
            database,
            expectedSourceId: chosen,
            exactUserTimestamp: timestamp,
            submittedText: timestamp,
            isCurrent: () => true,
          });
          if (out.status !== 'current') return;
          held = true;
          return {
            current: out.witness.current,
            dispose() {
              held = false;
              out.witness.dispose();
            },
          };
        };
        const generate = jest.fn(async () => {
          expect(held).toBe(true);
          return providerSuccess({
            text: 'synthetic',
            finishReason: 'complete' as const,
            toolCalls: [],
          });
        });
        const streamStarted = jest.fn();
        const provider = {
          ...publicEvidenceFixture().selected.provider,
          generate,
          async *stream() {
            expect(held).toBe(true);
            streamStarted();
            yield providerSuccess({
              type: 'text_delta' as const,
              text: 'synthetic',
            });
          },
        };
        const nativeSample = jest.fn(async () => {
          expect(held).toBe(true);
          if (state === 'selected-edited') await time(chosen, later);
          if (state === 'new-collision') await time(other, timestamp);
          if (state === 'queued-collision')
            queuedMutation = Promise.resolve().then(() =>
              time(other, timestamp),
            );
          return state !== 'native-locked';
        });
        const guarded = guardSelectedRecordingProvider(
          provider,
          nativeSample,
          () => true,
          hold,
        );
        if (method === 'generate') await guarded.generate(request);
        else {
          const iterator = guarded.stream!(request)[Symbol.asyncIterator]();
          await iterator.next();
          await iterator.return?.();
        }
        await queuedMutation;
        const actual = method === 'generate' ? generate : streamStarted;
        expect(actual).toHaveBeenCalledTimes(state === 'valid' ? 1 : 0);
        expect(held).toBe(false);
        expect(nativeSample).toHaveBeenCalledTimes(
          state === 'payload-mismatch' ? 0 : 1,
        );
      },
      false,
      true,
    ),
);
