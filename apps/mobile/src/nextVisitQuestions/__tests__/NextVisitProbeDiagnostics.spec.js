const dismissToast = require('../../../e2e/nextVisitProbeDiagnostics');

describe('Next Visit debug toast dismissal', () => {
  const warningText = 'Open debugger to view warnings.';
  const originals = {};
  let warning;
  let appeared;
  let disappeared;
  let device;
  let root;

  beforeEach(() => {
    for (const key of ['by', 'element', 'waitFor'])
      originals[key] = global[key];
    appeared = jest.fn().mockResolvedValue(undefined);
    disappeared = jest.fn().mockResolvedValue(undefined);
    warning = {
      getAttributes: jest.fn().mockResolvedValue({
        visible: true,
        frame: { x: 60, y: 800, width: 300, height: 20 },
      }),
    };
    // The CI failure occurred inside device.tap's separate XCTest process.
    device = { tap: jest.fn().mockRejectedValue(new Error('AX -25218')) };
    root = {
      getAttributes: jest.fn().mockResolvedValue({
        frame: { x: 10, y: 20, width: 400, height: 900 },
      }),
      tap: jest.fn().mockResolvedValue(undefined),
    };
    global.by = {
      text: text => text,
      type: type => ({ withDescendant: text => ({ type, text }) }),
    };
    global.element = selector => {
      if (typeof selector === 'object') {
        expect(selector).toEqual({
          type: 'RCTRootComponentView',
          text: warningText,
        });
        return root;
      }
      expect(selector).toBe(warningText);
      return warning;
    };
    global.waitFor = target => {
      expect(target).toBe(warning);
      return {
        toExist: () => ({ withTimeout: appeared }),
        not: { toExist: () => ({ withTimeout: disappeared }) },
      };
    };
  });

  afterEach(() => {
    Object.assign(global, originals);
  });

  it('dismisses the observed toast through an element-relative tap and confirms removal', async () => {
    await dismissToast(device);
    expect(root.tap).toHaveBeenCalledWith({ x: 365, y: 790 });
    expect(device.tap).not.toHaveBeenCalled();
    expect(disappeared).toHaveBeenCalledWith(10000);
  });

  it('ignores only the exact absent-debug-toast expectation', async () => {
    const error = new Error(
      `Timed out while waiting for expectation: TOEXIST WITH MATCHER(text == “${warningText}”) TIMEOUT(1s)`,
    );
    error.name = 'DetoxRuntimeError';
    appeared.mockRejectedValue(error);
    await dismissToast(device);
    expect(root.tap).not.toHaveBeenCalled();
  });

  it('preserves unrelated errors and dismissal failures', async () => {
    const error = new Error('unrelated product or automation failure');
    appeared.mockRejectedValueOnce(error);
    await expect(dismissToast(device)).rejects.toBe(error);
    disappeared.mockRejectedValueOnce(error);
    await expect(dismissToast(device)).rejects.toBe(error);
  });
});
