import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import {
  dailyReportProviderFixture,
  dailyReportRequestFixture,
  dailyReportSourceSnapshotFixture,
} from '../../healthEvidence/healthContext/testSupport/dailyReportContextFixture';
import { validateDailyReportCompletion } from '../dailyReportValidation';

const calendar = createDailyReportCalendarWindow(dailyReportRequestFixture);
if (calendar.status !== 'ready')
  throw new Error('Invalid synthetic calendar fixture.');
const context = createDailyReportContext(
  calendar.context,
  dailyReportSourceSnapshotFixture,
  dailyReportProviderFixture,
);
const output = {
  schemaVersion: 1 as const,
  identity: context.identity,
  generatedAt: '2026-03-08T16:16:00.000Z',
  observations: [
    {
      text: 'Synthetic observation',
      sourceReferences: [
        { source: 'healthkit.phone', recordId: 'steps-phone' },
      ],
    },
  ],
  supportedContext: [],
  coverage: context.sourceSnapshot.coverage,
  followUpQuestions: [],
};

test('accepts a completed report grounded in the input snapshot', () => {
  expect(
    validateDailyReportCompletion(context, {
      status: 'completed',
      report: output,
    }),
  ).not.toBeNull();
});

test('rejects incomplete, mismatched, ungrounded and misleading completions', () => {
  expect(
    validateDailyReportCompletion(context, {
      status: 'failed',
      code: 'timeout',
      retryable: true,
    }),
  ).toBeNull();
  expect(
    validateDailyReportCompletion(context, {
      status: 'completed',
      report: { ...output, identity: { ...output.identity, key: 'wrong' } },
    }),
  ).toBeNull();
  expect(
    validateDailyReportCompletion(context, {
      status: 'completed',
      report: { ...output, generatedAt: '2026-03-08T16:00:00Z' },
    }),
  ).toBeNull();
  expect(
    validateDailyReportCompletion(context, {
      status: 'completed',
      report: { ...output, coverage: [] },
    }),
  ).toBeNull();
  expect(
    validateDailyReportCompletion(context, {
      status: 'completed',
      report: {
        ...output,
        observations: [
          {
            text: 'Synthetic',
            sourceReferences: [
              { source: 'healthkit.watch', recordId: 'steps-phone' },
            ],
          },
        ],
      },
    }),
  ).toBeNull();
});
