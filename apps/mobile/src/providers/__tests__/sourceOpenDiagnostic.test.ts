import { createSourceOpenTiming } from '../sourceOpenDiagnostic';

test('separates sheet, DB admission, proof, and authorized layout without data', () => {
  const controller = new AbortController();
  const report = jest.fn();
  let clock = 100;
  const stage = createSourceOpenTiming(controller.signal, () => clock, report);
  stage.mark('source_open_public_tap');
  clock += 10;
  const entered = stage.span('source_open_db_admission');
  clock += 15;
  stage.mark('source_open_public_show');
  clock += 25;
  entered?.();
  const finished = stage.span('source_open_db_work');
  clock += 30;
  finished?.();
  stage.mark('source_open_public_proof');
  clock += 5;
  stage.mark('source_open_public_ready');
  stage.mark('source_open_public_ready');
  expect(report.mock.calls).toEqual([
    ['source_open_public_tap', 0],
    ['source_open_public_show', 25],
    ['source_open_db_admission', 40],
    ['source_open_db_work', 30],
    ['source_open_public_proof', 80],
    ['source_open_public_ready', 85],
  ]);
  controller.abort();
  stage.mark('source_open_local_admission');
  expect(report).toHaveBeenCalledTimes(6);
});

test('rejects backwards/out-of-bound times and retires a dismissed completed read', () => {
  const report = jest.fn();
  let clock = 100;
  const stage = createSourceOpenTiming(
    new AbortController().signal,
    () => clock,
    report,
  );
  clock = 50;
  stage.mark('source_open_public_show');
  clock = 300_101;
  stage.mark('source_open_public_ready');
  stage.retire();
  stage.mark('source_open_public_proof');
  expect(report).not.toHaveBeenCalled();
});
