import { useState } from 'react';
import { AppButton } from '../src/layout/AppButton';
import { feature } from './dailyReportVisualFixture';

type Settlement = 'release' | 'reject' | 'cancel';
type PendingPreview = { settle: (outcome: Settlement) => void };

/** Hold only the synthetic preview read. Saved lookup uses the existing fixture. */
export function useControlledDailyReportPreview() {
  const [pending, setPending] = useState<PendingPreview | null>(null);
  const [reportFeature] = useState<typeof feature>(() => ({
    ...feature,
    preview: async (_identity, signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) {
          resolve({ status: 'cancelled' });
          return;
        }
        const abort = () => operation.settle('cancel');
        const operation: PendingPreview = {
          settle(outcome) {
            signal.removeEventListener('abort', abort);
            setPending(current => (current === operation ? null : current));
            if (outcome === 'reject') {
              reject(new Error('Synthetic preview read failure'));
              return;
            }
            resolve(
              outcome === 'cancel'
                ? { status: 'cancelled' }
                : {
                    status: 'ready',
                    cutoff: '2035-01-01T03:00:00Z',
                    timeZone: 'Asia/Seoul',
                    count: 1,
                    partial: false,
                    coverage: [
                      {
                        source: 'health_observation',
                        status: 'unknown',
                        limitationCodes: ['source_sync_unknown'],
                      },
                    ],
                    sourceCounts: new Map([['health_observation', 1]]),
                    latestSourceTime: null,
                  },
            );
          },
        };
        signal.addEventListener('abort', abort, { once: true });
        setPending(operation);
      }),
  }));
  return {
    reportFeature,
    controls: (
      <>
        <AppButton
          testID="daily-report-fixture-reject-preview"
          title="Reject preview"
          variant="text"
          disabled={!pending}
          onPress={() => pending?.settle('reject')}
        />
        <AppButton
          testID="daily-report-fixture-release-preview"
          title="Release preview"
          variant="text"
          disabled={!pending}
          onPress={() => pending?.settle('release')}
        />
      </>
    ),
  };
}
