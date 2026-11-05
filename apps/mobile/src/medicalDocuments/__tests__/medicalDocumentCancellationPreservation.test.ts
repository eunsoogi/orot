import { NativeModules } from 'react-native';
import type { RecordRepository } from '@orot/storage';
import { createMedicalDocumentImportService } from '../medicalDocumentImportService';
import {
  discardMedicalDocumentFromLifecycle,
  trackStagedMedicalDocument,
} from '../medicalDocumentLifecycle';

test('cancellation retains saved and unrelated staged IDs without writing or deleting', async () => {
  const saved = '11111111-1111-4111-8111-111111111111';
  const staged = '22222222-2222-4222-8222-222222222222';
  const previous = NativeModules.MedicalDocumentImportModule;
  const native = {
    pickMedicalDocumentPhoto: jest.fn().mockResolvedValue(null),
    reconcileMedicalDocumentFiles: jest.fn().mockResolvedValue(undefined),
    stageMedicalDocumentDeletion: jest.fn(),
    restoreMedicalDocumentDeletion: jest.fn(),
    commitMedicalDocumentDeletion: jest.fn(),
    discardMedicalDocument: jest.fn(),
    ensureMedicalDocumentOriginal: jest.fn(),
  };
  const transaction = jest.fn();
  const repository = {
    list: jest
      .fn()
      .mockResolvedValue([{ id: saved, sourceKind: 'medical_document' }]),
    transaction,
  } as unknown as RecordRepository;
  NativeModules.MedicalDocumentImportModule = native;
  trackStagedMedicalDocument(staged);
  try {
    const service = createMedicalDocumentImportService({
      loadRepository: async () => repository,
    });
    await expect(service.selectDocument('photos')).resolves.toBeNull();
    // Reconciliation may change files, but it must receive every ID that remains protected.
    expect(
      new Set(native.reconcileMedicalDocumentFiles.mock.calls[0]?.[0]),
    ).toEqual(new Set([saved, staged]));
    expect(native.pickMedicalDocumentPhoto).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(native.stageMedicalDocumentDeletion).not.toHaveBeenCalled();
    expect(native.commitMedicalDocumentDeletion).not.toHaveBeenCalled();
    expect(native.discardMedicalDocument).not.toHaveBeenCalled();
  } finally {
    discardMedicalDocumentFromLifecycle(staged);
    if (previous === undefined)
      delete NativeModules.MedicalDocumentImportModule;
    else NativeModules.MedicalDocumentImportModule = previous;
  }
});
