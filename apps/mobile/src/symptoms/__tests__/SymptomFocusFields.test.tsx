import { fireEvent, render, screen } from '@testing-library/react-native';
import SymptomForm from '../SymptomForm';
import SymptomFilters from '../SymptomFilters';
import { SymptomFocusRevealContext } from '../SymptomTextInput';

function controller() {
  return {
    focusInput: jest.fn(),
    blurInput: jest.fn(),
    revealFocused: jest.fn(),
    onScroll: jest.fn(),
  };
}

describe('symptom fields participating in focus reveal', () => {
  it.each([
    'description',
    'onset-date',
    'onset-time',
    'resolved-date',
    'resolved-time',
    'body-site',
    'severity',
  ])(
    'registers the native %s field and preserves its controlled text',
    async suffix => {
      const reveal = controller();
      await render(
        <SymptomFocusRevealContext.Provider value={reveal}>
          <SymptomForm
            mode="create"
            onCancel={jest.fn()}
            onCreate={jest.fn()}
            onUpdate={jest.fn()}
          />
        </SymptomFocusRevealContext.Provider>,
      );
      await fireEvent.press(screen.getByTestId('symptom-status-resolved'));
      const field = screen.getByTestId('symptom-' + suffix);
      await fireEvent(field, 'focus', { nativeEvent: {} });
      expect(reveal.focusInput).toHaveBeenCalledWith(expect.anything());
      await fireEvent.changeText(field, 'synthetic input');
      expect(screen.getByTestId('symptom-' + suffix)).toHaveProp(
        'value',
        'synthetic input',
      );
      await fireEvent(field, 'blur', { nativeEvent: {} });
      expect(reveal.blurInput).toHaveBeenCalledWith(
        reveal.focusInput.mock.calls[0][0],
      );
    },
  );

  it.each(['from-date', 'from-time', 'through-date', 'through-time'])(
    'registers the native filter %s field',
    async suffix => {
      const reveal = controller();
      await render(
        <SymptomFocusRevealContext.Provider value={reveal}>
          <SymptomFilters onFilterChange={jest.fn()} />
        </SymptomFocusRevealContext.Provider>,
      );
      await fireEvent(screen.getByTestId('symptom-filter-' + suffix), 'focus', {
        nativeEvent: {},
      });
      expect(reveal.focusInput).toHaveBeenCalledWith(expect.anything());
    },
  );
});
