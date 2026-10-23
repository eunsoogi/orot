import { spawn } from 'node:child_process';

/** Keep Device Hub menu input scoped to the unique window named by the owner Simulator record. */
export function deviceHubFaceIdScript() {
  return String.raw`on run argv
  set actionName to item 1 of argv
  set simulatorName to item 2 of argv
  tell application "System Events"
    set deviceHub to first application process whose bundle identifier is "com.apple.dt.Devices"
    set windowTitles to name of every window of deviceHub
    set ownedWindows to every window of deviceHub whose name contains simulatorName
    if (count of ownedWindows) is not 1 then
      error "Expected one Device Hub window for the owner Simulator; available window titles: " & (windowTitles as text)
    end if
    set frontmost of deviceHub to true
    tell menu bar 1 of deviceHub
      click menu bar item "Device"
      tell menu 1 of menu bar item "Device"
        click menu item "Face ID"
        tell menu 1 of menu item "Face ID"
          if actionName is "enroll" then
            click menu item "Enrolled"
          else if actionName is "authorize" then
            click menu item "Authorized with Face ID"
          else
            error "Unknown Face ID control action"
          end if
        end tell
      end tell
    end tell
  end tell
end run`;
}

/** Send one documented menu action and preserve its actual host error. */
export function runDeviceHubFaceIdAction(
  action,
  owner,
  { spawnProcess = spawn, timeoutMs = 10000 } = {},
) {
  if (!['enroll', 'authorize'].includes(action))
    throw new Error('Unsupported Device Hub Face ID action');
  if (typeof owner?.name !== 'string' || owner.name.length === 0)
    throw new Error('Face ID input requires the owner Simulator name');

  return new Promise((accept, reject) => {
    const child = spawnProcess('osascript', ['-e', deviceHubFaceIdScript(), action, owner.name], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else accept(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Device Hub Face ID ${action} action exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.once('error', (error) => finish(error));
    child.once('close', (status, signal) => {
      if (status === 0 && !signal) finish(null, { stdout, stderr });
      else
        finish(
          new Error(
            `Device Hub Face ID ${action} action failed (${signal ?? status}): ${stderr.trim() || stdout.trim()}`,
          ),
        );
    });
  });
}
