import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LeaseProbeOverlay } from '../LeaseProbeOverlay';

test('keeps synthetic controls outside the navigation viewport layout flow', async () => {
  await render(
    <LeaseProbeOverlay>
      <Text>Lease observation</Text>
    </LeaseProbeOverlay>,
  );
  const panel = screen.getByTestId('retention-probe-overlay');
  expect(panel).toHaveStyle({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  });
  expect(panel.props.pointerEvents).toBe('box-none');
  expect(screen.getByText('Lease observation')).toBeOnTheScreen();
});

// This opt-in entry opens encrypted storage at import time, so inspect only its mounting contract.
test('mounts the lease controls in the overlay instead of a viewport-shifting sibling', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(
      __dirname,
      '../conversationLeaseReleaseProbeEntry.tsx',
    ),
    'utf8',
  );
  expect(source).toMatch(
    /<LeaseProbeOverlay>[\s\S]*retention-probe-status[\s\S]*<\/LeaseProbeOverlay>/,
  );
  expect(source).not.toMatch(/<SafeAreaView/);
});
