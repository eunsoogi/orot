import {
  createOverviewWorkoutSelectionAdmission,
  syncWorkoutChoiceAdoption,
} from './overviewWorkoutSelectionAdmission';
import {
  selectedWorkoutChoiceProof,
  watchWorkoutChoiceExpiry,
  workoutChoiceReceiptCurrent,
} from './earlyWorkoutChoice';

test('wall clock jumps confer no extra time or early expiry', () => {
  jest.useFakeTimers();
  try {
    const receipt = selectedWorkoutChoiceProof({
      selection: ['heartRate'],
      witness: 'synthetic',
    });
    if (!receipt) throw new Error('Expected a test receipt.');
    const expired = jest.fn();
    const cancel = watchWorkoutChoiceExpiry(receipt, expired);
    jest.setSystemTime(new Date('2055-01-01'));
    expect(workoutChoiceReceiptCurrent(receipt)).toBe(true);
    jest.advanceTimersByTime(1999);
    expect(expired).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2005-01-01'));
    expect(workoutChoiceReceiptCurrent(receipt)).toBe(true);
    jest.advanceTimersByTime(1);
    expect(workoutChoiceReceiptCurrent(receipt)).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
    cancel?.();
  } finally {
    jest.useRealTimers();
  }
});

test.each(['same', 'missing', 'differing', 'expired', 'retired'] as const)(
  'a full projection only takes over a live exact provisional owner: %s',
  mode => {
    jest.useFakeTimers();
    try {
      const receipt = selectedWorkoutChoiceProof({
        selection: ['heartRate'],
        witness: 'fixture',
      });
      if (!receipt) throw new Error('Expected a test receipt.');
      const gate = createOverviewWorkoutSelectionAdmission();
      const retire = jest.fn();
      gate.update(null, receipt);
      const owner = {
        receipt,
        settled: mode === 'retired',
        usable: () => mode !== 'retired',
        stopExpiry: gate.expireProvisional(receipt, () => true, retire),
      };
      if (mode === 'expired') jest.advanceTimersByTime(2000);
      gate.update(
        1,
        undefined,
        mode === 'same' || mode === 'expired' || mode === 'retired'
          ? 'fixture'
          : mode === 'differing'
            ? 'changed'
            : undefined,
      );
      expect(syncWorkoutChoiceAdoption(owner, () => 'active', gate)).toBe(
        mode === 'same',
      );
      expect(gate.holds(receipt)).toBe(mode === 'same');
      if (mode === 'same') expect(owner.stopExpiry).toBeUndefined();
      jest.advanceTimersByTime(2000);
      expect(retire).toHaveBeenCalledTimes(mode === 'same' ? 0 : 1);
    } finally {
      jest.useRealTimers();
    }
  },
);
