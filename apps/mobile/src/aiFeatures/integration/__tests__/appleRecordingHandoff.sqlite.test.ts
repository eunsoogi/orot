import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import type { AppleModelAvailability } from '@orot/provider-apple';
import type { LanguageModelResponse } from '@orot/model-runtime';
import { guardSelectedRecordingProvider } from '../selectedRecordingProvider';
import { proveSelectedRecordingTimestamp } from '../selectedRecordingTimestampProof';
import {
  chosen,
  other,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';

const exact = '2090-01-01T00:10:00.000Z';
const otherTime = '2090-01-03T00:10:00.000Z';
const request = {
  messages: [{ role: 'user' as const, content: 'Synthetic question' }],
};
const response: LanguageModelResponse = {
  text: 'synthetic',
  toolCalls: [],
  finishReason: 'complete',
};

it.each([
  ['generate', 'valid', 'on-device'],
  ['generate', 'collision', 'on-device'],
  ['generate', 'protected-lock', 'on-device'],
  ['stream', 'valid', 'on-device'],
  ['stream', 'collision', 'on-device'],
  ['stream', 'protected-lock', 'on-device'],
  ['generate', 'valid', 'private-cloud-compute'],
  ['stream', 'collision', 'private-cloud-compute'],
] as const)(
  'Apple %s checks after held availability before bridge (%s, %s)',
  (mode, state, route) =>
    withRecordings(
      async (_data, _edit, _storage, database) => {
        const setOtherTime = (time: string) =>
          database.execute(
            "UPDATE source_records SET recorded_at=?, payload_json=json_set(payload_json,'$.recordedAt',?) WHERE id=?",
            [time, time, other],
          );
        await setOtherTime(otherTime);
        let release!: (available: AppleModelAvailability) => void;
        const wait = new Promise<AppleModelAvailability>(resolve => {
          release = resolve;
        });
        let held = false;
        let nativeProtected = true;
        const nativeGenerate = jest.fn(async () => {
          expect(held).toBe(true);
          return response;
        });
        const nativeStream = jest.fn();
        const apple = new AppleFoundationModelsProvider(
          {
            getAvailability: () => wait,
            generate: nativeGenerate,
            async *stream() {
              expect(held).toBe(true);
              nativeStream();
              yield { type: 'completed', response };
            },
            cancel: jest.fn(),
          },
          route,
        );
        const hold = jest.fn(async () => {
          const match = await proveSelectedRecordingTimestamp({
            database,
            submittedText: exact,
            exactUserTimestamp: exact,
            expectedSourceId: chosen,
            isCurrent: () => true,
          });
          if (match.status !== 'current') return;
          held = true;
          return {
            current: match.witness.current,
            dispose() {
              held = false;
              match.witness.dispose();
            },
          };
        });
        const protectedSample = jest.fn(async () => nativeProtected);
        const guarded = guardSelectedRecordingProvider(
          apple,
          protectedSample,
          () => true,
          hold,
        );
        const iterator =
          mode === 'stream'
            ? guarded.stream!(request)[Symbol.asyncIterator]()
            : undefined;
        const pending = iterator
          ? iterator.next().then(value => value.value)
          : guarded.generate(request);
        expect(hold).not.toHaveBeenCalled();
        if (state === 'collision') await setOtherTime(exact);
        if (state === 'protected-lock') nativeProtected = false;
        release({ status: 'available' });
        await expect(pending).resolves.toMatchObject({ ok: state === 'valid' });
        await iterator?.return?.();
        expect(
          mode === 'generate' ? nativeGenerate : nativeStream,
        ).toHaveBeenCalledTimes(state === 'valid' ? 1 : 0);
        expect(held).toBe(false);
        expect(hold).toHaveBeenCalledTimes(1);
        expect(protectedSample).toHaveBeenCalledTimes(
          state === 'collision' ? 0 : 1,
        );
      },
      false,
      true,
    ),
);
