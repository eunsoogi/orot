import { backupProbeFailureReason } from '../e2e/backupProbeFailure';

describe('backup probe diagnostic boundary', () => {
  it('reports known fixture failures without copying arbitrary native messages', () => {
    expect(
      backupProbeFailureReason(
        new Error('The dedicated backup-probe bridge is unavailable.'),
      ),
    ).toBe('probe-bridge-unavailable');
    expect(
      backupProbeFailureReason(
        new Error('The synthetic recording is unreadable or backup-excluded.'),
      ),
    ).toBe('recording-state-invalid');
    for (const error of [
      new Error('/private/user/secret'),
      new Error('constructor'),
      new Error('toString'),
      { message: 'private' },
      'private',
      null,
    ])
      expect(backupProbeFailureReason(error)).toBe(
        'unclassified-probe-failure',
      );
  });
});
