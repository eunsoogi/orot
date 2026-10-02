import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';

test('shows the initial welcome state', async () => {
  await render(<App />);

  expect(screen.getByRole('header', { name: 'Orot workspace ready' })).toBeTruthy();
  expect(screen.getByText('A simple foundation for Orot.')).toBeTruthy();
});

test('updates the welcome message when the user gets started', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByRole('button', { name: 'Get started' }));

  expect(screen.getByText('You are ready to build.')).toBeTruthy();
});
