import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from 'react-native';
import { NavigationRootLayoutContext } from '../../navigation/navigationRootLayout';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { RecordsRoute } from '../../routes/RecordsRoute';
import type { MedicalDocumentImportService } from '../medicalDocumentImportService';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('moves review actions without retaining the discarded photo after a save failure', async () => {
  const photo = (id: string) => ({
    id,
    displayName: `${id}.jpg`,
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    previewData: 'data:image/jpeg;base64,c3ludGhldGlj',
    sections: [],
  });
  const first = photo('first');
  const second = photo('second');
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn(),
    selectDocument: jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second),
    saveDocument: jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic failure'))
      .mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  const rail = {
    placement: 'right' as const,
    reservedRightWidth: 72,
    contentWidth: 400,
    windowHeight: 340,
    railTopInset: 20,
    railBottomInset: 20,
    railRightInset: 12,
    systemBottomInset: 0,
  };
  function Fixture({ height }: { height: number }) {
    const { host, actions } = useNavigationPrimaryActionHost('records');
    return (
      <NavigationRootLayoutContext.Provider
        value={{ ...rail, windowHeight: height }}
      >
        <NavigationPrimaryActionContext.Provider value={host}>
          <RecordsRoute
            recordings={[]}
            recordingState="ready"
            onRetryRecordings={jest.fn()}
            onOpenSavedRecordings={jest.fn()}
            onOpenRecording={jest.fn()}
            onOpenHealthLibrary={jest.fn()}
            onOpenManualHistory={jest.fn()}
            documentImportService={service}
          />
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              disabled={action.disabled}
              onPress={() => action.onPress()}
            />
          ))}
        </NavigationPrimaryActionContext.Provider>
      </NavigationRootLayoutContext.Provider>
    );
  }
  const view = await render(<Fixture height={340} />);
  await fireEvent.press(screen.getByTestId('records-import-medical-photo'));
  expect(
    screen.getByTestId('medical-document-review-filename'),
  ).toHaveTextContent('first.jpg');
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(screen.getByTestId('medical-document-import-status')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-document-cancel'));
  expect(service.discardDocument).toHaveBeenCalledWith(first);
  await fireEvent.press(screen.getByTestId('records-import-medical-photo'));
  expect(
    screen.getByTestId('medical-document-review-filename'),
  ).toHaveTextContent('second.jpg');
  await view.rerender(<Fixture height={444} />);
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
  expect(screen.getAllByTestId('dock-save-medical-document')).toHaveLength(1);
  expect(screen.getAllByTestId('dock-cancel-medical-document')).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('dock-save-medical-document'));
  expect(service.saveDocument).toHaveBeenNthCalledWith(1, first);
  expect(service.saveDocument).toHaveBeenNthCalledWith(2, second);
  expect(screen.queryByTestId('dock-save-medical-document')).toBeNull();
});
