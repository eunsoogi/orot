const {
  dismissRecordingExportShareSheet,
} = require('../e2e/transcription/recordingExportDetoxHelpers');

const screen = { x: 0, y: 0, width: 402, height: 874 };

function harness(rootFrame = screen, dismissalFrame = screen) {
  const popup = {
    getAttributes: jest.fn().mockResolvedValue({ frame: dismissalFrame }),
  };
  const root = {
    getAttributes: jest.fn().mockResolvedValue({ frame: rootFrame }),
    tap: jest.fn().mockResolvedValue(undefined),
  };
  const disappeared = jest.fn().mockResolvedValue(undefined);
  const device = { tap: jest.fn() };
  const api = {
    by: { label: value => value, type: value => value },
    device,
    element: jest.fn(matcher => {
      if (matcher === 'dismiss popup') return popup;
      if (matcher === 'RCTRootComponentView') return root;
      throw new Error('Unexpected target');
    }),
    waitFor: jest.fn(target => {
      expect(target).toBe(popup);
      return {
        toExist: () => ({
          withTimeout: jest.fn().mockResolvedValue(undefined),
        }),
        not: { toExist: () => ({ withTimeout: disappeared }) },
      };
    }),
  };
  return { api, root, device, disappeared };
}

describe('recording export share-sheet dismissal', () => {
  it.each([
    [screen, screen, { x: 201, y: 175 }],
    [
      { x: 10.5, y: 20.25, width: 393, height: 852 },
      { x: 0.5, y: 1.25, width: 393, height: 852 },
      { x: 186.5, y: 151.75 },
    ],
  ])(
    'converts the observed screen point to root-local coordinates',
    async (rootFrame, dismissalFrame, localPoint) => {
      const { api, root, device, disappeared } = harness(
        rootFrame,
        dismissalFrame,
      );
      await dismissRecordingExportShareSheet(api);
      expect(root.tap).toHaveBeenCalledTimes(1);
      expect(root.tap).toHaveBeenCalledWith(localPoint);
      expect(device.tap).not.toHaveBeenCalled();
      expect(disappeared).toHaveBeenCalledWith(30000);
      expect(root.tap.mock.invocationCallOrder[0]).toBeLessThan(
        disappeared.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([
    { ...screen, width: 0 },
    { ...screen, y: Number.NaN },
    { ...screen, x: 300 },
    { ...screen, height: 100 },
  ])(
    'rejects geometry that cannot contain the dismissal point',
    async frame => {
      const { api, root, disappeared } = harness(frame);
      await expect(dismissRecordingExportShareSheet(api)).rejects.toThrow();
      expect(root.tap).not.toHaveBeenCalled();
      expect(disappeared).not.toHaveBeenCalled();
    },
  );

  it('preserves a native tap failure without trying another input route', async () => {
    const { api, root, device, disappeared } = harness();
    root.tap.mockRejectedValue(new Error('Native hit test failed'));
    await expect(dismissRecordingExportShareSheet(api)).rejects.toThrow(
      'Native hit test failed',
    );
    expect(root.tap).toHaveBeenCalledTimes(1);
    expect(device.tap).not.toHaveBeenCalled();
    expect(disappeared).not.toHaveBeenCalled();
  });
});
