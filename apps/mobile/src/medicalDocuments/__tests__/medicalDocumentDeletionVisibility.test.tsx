import { act, renderHook } from '@testing-library/react-native';
import { useMedicalDocumentImport } from '../useMedicalDocumentImport';
import type {
  MedicalDocumentImportService,
  SavedMedicalDocument,
} from '../medicalDocumentImportService';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';

test('invalidates visible excerpts and pending opens before file cleanup finishes', async () => {
  const document = {
    id: 'synthetic-document',
    sourceKind: 'medical_document',
    evidenceSpans: [],
  } as unknown as SavedMedicalDocument;
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn(async () => [document]),
    getDocument: jest.fn(async () => document),
    selectDocument: jest.fn(),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  const hook = await renderHook(() => useMedicalDocumentImport(service));
  await act(async () => {
    await hook.result.current.openSavedDocument(document.id);
  });
  expect(hook.result.current.sourceDetail).toBe(document);
  const calls = jest.mocked(service.getDocument).mock.calls.length;
  await act(async () => {
    hook.result.current.setDeletionBusy(true);
    await hook.result.current.openSavedDocument('another-document');
  });
  expect(service.getDocument).toHaveBeenCalledTimes(calls);
  await act(async () => {
    hook.result.current.setDeletionBusy(false);
  });
  let finish!: (value: SavedMedicalDocument) => void;
  jest.mocked(service.getDocument).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let opening!: Promise<void>;
  await act(async () => {
    opening = hook.result.current.openSavedDocument(document.id);
  });
  jest.mocked(service.listDocuments).mockResolvedValue([]);
  await act(async () => {
    notifyLocalSourceDeleted();
  });
  expect(hook.result.current.sourceDetail).toBeNull();
  expect(hook.result.current.savedDocuments).toEqual([]);
  await act(async () => {
    finish(document);
    await opening;
  });
  expect(hook.result.current.sourceDetail).toBeNull();
  jest.mocked(service.getDocument).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    opening = hook.result.current.openSavedDocument(document.id);
  });
  await act(async () => {
    hook.result.current.closeSavedDocument();
  });
  expect(hook.result.current.sourceLoading).toBe(false);
  await act(async () => {
    finish(document);
    await opening;
  });
  expect(hook.result.current.sourceDetail).toBeNull();
});
