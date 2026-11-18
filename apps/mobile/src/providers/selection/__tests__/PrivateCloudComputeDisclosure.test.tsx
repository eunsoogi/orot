import { fireEvent, render, screen } from '@testing-library/react-native';
import { applePrivateCloudComputeProvider } from '../../apple';
import ProviderSelectionConfirmation from '../ProviderSelectionConfirmation';
import { loadPrivateCloudComputeOption } from '../privateCloudCompute';
import { t } from '../../../i18n';

it('names Apple cloud transmission and waits for explicit confirmation', async () => {
  const availability = jest
    .spyOn(applePrivateCloudComputeProvider, 'getAvailability')
    .mockResolvedValue({ status: 'available' });
  const option = await loadPrivateCloudComputeOption();
  const onConfirm = jest.fn();
  await render(
    <ProviderSelectionConfirmation
      option={option}
      blockedMessage={null}
      canConfirm
      saving={false}
      onConfirm={onConfirm}
      onCancel={jest.fn()}
    />,
  );
  expect(
    screen.getByTestId('provider-selection-confirmation-privacy'),
  ).toHaveTextContent(t('provider.pcc.privacy'));
  expect(screen.queryByText(t('provider.selection.remotePrivacy'))).toBeNull();
  expect(onConfirm).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  availability.mockRestore();
});
