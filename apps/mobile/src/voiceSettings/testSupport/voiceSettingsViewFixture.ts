import { render, waitFor } from '@testing-library/react-native';

// Keep the same enabled-state assertion at every asynchronous catalog entry.
export async function waitForRefreshEnabled(
  view: Awaited<ReturnType<typeof render>>,
) {
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
}
