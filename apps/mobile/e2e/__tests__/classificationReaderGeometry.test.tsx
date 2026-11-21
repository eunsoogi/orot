import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  ClassificationReaderGeometryProbe,
  readerGeometryDocuments,
} from '../ClassificationReaderGeometryProbe';

jest.mock('../classificationLayoutReceipt', () => ({
  useClassificationLayoutReceipt: () => ({ request: jest.fn(), marker: null }),
}));
jest.mock('../../src/medicalAppointments/ClassificationPagedStage', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    ClassificationPagedStage: jest.fn(({ onAction, documents }) => (
      <Text
        testID="synthetic-product-action"
        onPress={onAction}
        accessibilityLabel={JSON.stringify(documents)}
      >
        action
      </Text>
    )),
  };
});

// This proves host props and local-only effects, not native pagination or Modal timing.
it('passes both indexed documents unchanged and confines actions to a local counter', async () => {
  const view = await render(<ClassificationReaderGeometryProbe />);
  expect(
    JSON.parse(
      view.getByTestId('synthetic-product-action').props.accessibilityLabel,
    ),
  ).toEqual(readerGeometryDocuments);
  expect(readerGeometryDocuments).toHaveLength(2);
  for (const [index, document] of readerGeometryDocuments.entries())
    for (const field of ['title', 'reason'])
      for (let segment = 1; segment <= 24; segment++)
        expect(document).toContain(`DOC${index + 1}_${field}_${segment}`);
  expect(
    view.getByTestId('classification-geometry-actions').props.children,
  ).toBe('actions=0;lane=natural');
  await fireEvent.press(view.getByTestId('classification-geometry-constrain'));
  expect(
    view.getByTestId('classification-geometry-lane').props.style.height,
  ).toBe(64);
  expect(
    view.getByTestId('classification-geometry-actions').props.children,
  ).toBe('actions=0;lane=constrained');
  await fireEvent.press(view.getByTestId('synthetic-product-action'));
  expect(
    view.getByTestId('classification-geometry-actions').props.children,
  ).toBe('actions=1;lane=constrained');
});
