/** Fail closed before mutation and always check the production app after runner installation starts. */
export async function executeProductionUi(operations) {
  const input = await operations.validate();
  await operations.preflight();
  let result;
  let failure;
  try {
    await operations.installRunner(input.runner);
    result = await operations.run(input);
  } catch (error) {
    failure = error;
  }
  try {
    await operations.verifyAfter(input);
  } catch (error) {
    if (failure)
      throw new AggregateError([failure, error], 'Run and production verification failed');
    throw error;
  }
  if (failure) throw failure;
  return result;
}
