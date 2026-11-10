import { act, renderHook } from '@testing-library/react-native';
import { t } from '../../i18n';
import { MedicalDocumentImportError } from '../medicalDocumentNativeBridge';
import type { MedicalDocumentImportService } from '../medicalDocumentImportService';
import { useMedicalDocumentImport } from '../useMedicalDocumentImport';

jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const photo = {
  id: 'synthetic-photo',
  displayName: '사진.jpg',
  contentHash: `sha256:${'a'.repeat(64)}` as const,
  sections: [
    {
      id: 'synthetic-section',
      text: 'Synthetic',
      startOffset: 0,
      endOffset: 9,
    },
  ],
};

test.each([
  ['SAVE_FAILED', 'medicalDocument.error.saveFailed'],
  ['STALE_DOCUMENT', 'medicalDocument.error.staleDocument'],
  [
    'DUPLICATE_RECOVERY_FAILED',
    'medicalDocument.error.duplicateRecoveryFailed',
  ],
] as const)(
  'retains review and gives guidance for %s',
  async (code, message) => {
    const service: MedicalDocumentImportService = {
      listDocuments: jest.fn().mockResolvedValue([]),
      getDocument: jest.fn(),
      selectDocument: jest.fn().mockResolvedValue(photo),
      saveDocument: jest
        .fn()
        .mockRejectedValue(new MedicalDocumentImportError(code)),
      discardDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { result } = await renderHook(() =>
      useMedicalDocumentImport(service),
    );
    await act(() => result.current.selectMedicalDocument('photos'));
    await act(() => result.current.saveMedicalDocument());
    expect(result.current.stagedDocument).toEqual(photo);
    expect(result.current.message).toBe(t(message));
    await act(() => result.current.discardMedicalDocument());
    expect(service.discardDocument).toHaveBeenCalledWith(photo);
  },
);

test('reserves a pending save before a second tap enters', async () => {
  let finish!: (result: 'saved') => void;
  const pending = new Promise<'saved'>(resolve => {
    finish = resolve;
  });
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn(),
    selectDocument: jest.fn().mockResolvedValue(photo),
    saveDocument: jest.fn(() => pending),
    discardDocument: jest.fn(),
  };
  const { result } = await renderHook(() => useMedicalDocumentImport(service));
  await act(() => result.current.selectMedicalDocument('photos'));
  await act(async () => {
    const first = result.current.saveMedicalDocument();
    const second = result.current.saveMedicalDocument();
    const cancel = result.current.discardMedicalDocument();
    expect(service.saveDocument).toHaveBeenCalledTimes(1);
    expect(service.discardDocument).not.toHaveBeenCalled();
    finish('saved');
    await Promise.all([first, second, cancel]);
  });
});

test('does not start a save while cancellation is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn(),
    selectDocument: jest.fn().mockResolvedValue(photo),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(() => pending),
  };
  const { result } = await renderHook(() => useMedicalDocumentImport(service));
  await act(() => result.current.selectMedicalDocument('photos'));
  await act(async () => {
    const cancel = result.current.discardMedicalDocument();
    const save = result.current.saveMedicalDocument();
    expect(service.saveDocument).not.toHaveBeenCalled();
    finish();
    await Promise.all([cancel, save]);
  });
});
