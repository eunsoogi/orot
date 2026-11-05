jest.mock('../../App', () => () => null);
jest.mock('../../src/agent/polyfills', () => ({}));
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('../../src/medicalDocuments/medicalDocumentNativeBridge', () => {
  const actual = jest.requireActual(
    '../../src/medicalDocuments/medicalDocumentNativeBridge',
  );
  return {
    ...actual,
    medicalDocumentNativeBridge: { pick: jest.fn(), discard: jest.fn() },
    medicalDocumentFileDeletion: { reconcile: jest.fn() },
  };
});

import { pickerRecoveryProbeService } from '../medicalDocumentPickerRecoveryProbeEntry';
import {
  medicalDocumentNativeBridge,
  medicalDocumentFileDeletion,
} from '../../src/medicalDocuments/medicalDocumentNativeBridge';

test('isolates reconciliation while forwarding both picker routes and cancellation', async () => {
  const pick = jest.mocked(medicalDocumentNativeBridge.pick);
  pick.mockResolvedValue(null);
  await expect(pickerRecoveryProbeService.listDocuments()).resolves.toEqual([]);
  await expect(
    pickerRecoveryProbeService.selectDocument('photos'),
  ).resolves.toBeNull();
  await expect(
    pickerRecoveryProbeService.selectDocument('files'),
  ).resolves.toBeNull();
  expect(pick.mock.calls.map(([source]) => source)).toEqual([
    'photos',
    'files',
  ]);
  expect(medicalDocumentFileDeletion.reconcile).not.toHaveBeenCalled();
});
