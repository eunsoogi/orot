import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import { t } from '../../i18n';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { MedicalDocumentImportAction } from '../MedicalDocumentImportAction';
import { MedicalDocumentReview } from '../MedicalDocumentReview';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('keeps picker import in the Records body and review actions in the navigation dock', async () => {
  const select = jest.fn();
  const save = jest.fn();
  const cancel = jest.fn();
  // Keep the navigation host mounted to verify that the picker action stays in the body.
  function Fixture({ review }: { review: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('records');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        {review ? (
          <MedicalDocumentReview
            document={{
              id: 'synthetic',
              displayName: 'Synthetic.pdf',
              contentHash: `sha256:${'a'.repeat(64)}`,
              sections: [],
            }}
            busy={false}
            message={null}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <MedicalDocumentImportAction
            opening={false}
            disabled={false}
            onPress={select}
          />
        )}
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              disabled={action.disabled}
              onPress={() => {
                action.onPress();
              }}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }
  const view = await render(<Fixture review={false} />);
  expect(screen.queryByTestId('dock-add-medical-document')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  expect(select).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture review />);
  expect(screen.queryByTestId('dock-add-medical-document')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-cancel-medical-document'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('dock-save-medical-document'));
  expect(save).toHaveBeenCalledTimes(1);
});

test('keeps the body import button disabled while the picker is opening', async () => {
  const select = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('records');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <MedicalDocumentImportAction opening disabled onPress={select} />
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              disabled={action.disabled}
              onPress={() => action.onPress()}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }

  await render(<Fixture />);
  expect(screen.queryByTestId('dock-add-medical-document')).toBeNull();
  const importButton = screen.getByTestId('records-import-medical-document');
  expect(importButton.props.accessibilityRole).toBe('button');
  expect(importButton.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByText(t('medicalDocument.import.opening'))).toBeTruthy();
  await fireEvent.press(importButton);
  expect(select).not.toHaveBeenCalled();
});
