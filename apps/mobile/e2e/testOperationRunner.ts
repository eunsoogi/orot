import { NativeModules, Platform } from 'react-native';
import { runDomainTestOperation } from './domainTestOperations';

interface NativeCommand {
  id: string;
  operation: string;
  parameters: Record<string, unknown>;
}
interface Control {
  nextRequest(): Promise<NativeCommand>;
  complete(id: string, result: Record<string, unknown>): void;
  fail(id: string, message: string): void;
}

/** Only the native test host mounts this consumer; ordinary bundles do not import this entry. */
export function startTestOperationRunner(): () => void {
  const control = NativeModules.OrotTestControl as Control | undefined;
  if (!control)
    throw new Error('The native test command bridge is unavailable');
  let active = true;
  async function consume() {
    while (active) {
      const command = await control!.nextRequest();
      if (!active) return;
      try {
        const value = await runDomainTestOperation(
          command.operation,
          command.parameters,
        );
        control!.complete(command.id, {
          ...value,
          platform: Platform.OS,
          runtime: (globalThis as unknown as { HermesInternal?: unknown })
            .HermesInternal
            ? 'Hermes'
            : 'unknown',
        });
      } catch (error) {
        control!.fail(
          command.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  consume().catch(error =>
    console.error('Native test command consumer failed', error),
  );
  return () => {
    active = false;
  };
}
