import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { MedicalDocumentImportAction } from '../MedicalDocumentImportAction';
import { MedicalDocumentReview } from '../MedicalDocumentReview';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('replaces picker Add with staged Save and Cancel while preserving callbacks', async () => {
  const select = jest.fn();
  const save = jest.fn();
  const cancel = jest.fn();
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
  await fireEvent.press(screen.getByTestId('dock-add-medical-document'));
  expect(select).toHaveBeenCalledTimes(1);
  await view.rerender(<Fixture review />);
  expect(screen.queryByTestId('dock-add-medical-document')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-cancel-medical-document'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('dock-save-medical-document'));
  expect(save).toHaveBeenCalledTimes(1);
});
