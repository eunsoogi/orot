import { render, screen } from '@testing-library/react-native';
import { HubBanner } from '../HubBanner';

test.each(['overview', 'settings'])(
  'renders an accessible data-free %s banner',
  async testID => {
    await render(
      <HubBanner
        title="Page title"
        subtitle="Page description"
        testID={testID}
      />,
    );
    expect(screen.getByTestId(`${testID}-title`)).toHaveTextContent(
      'Page title',
    );
    expect(screen.getByTestId(`${testID}-subtitle`)).toHaveTextContent(
      'Page description',
    );
    expect(screen.getByRole('header')).toHaveTextContent('Page title');
  },
);
