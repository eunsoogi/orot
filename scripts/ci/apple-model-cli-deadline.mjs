// The fixed system-Python program gives fm a controlling terminal and, under sudo,
// can terminate and reap its direct privileged child. PTY output remains raw and merged.
// No caller-supplied command, module, shell, PID or model-service name is accepted.
export const FM_LICENSE_WATCHDOG = String.raw`
import errno, json, os, pty, select, signal, sys, time
remaining = int(sys.argv[1]) / 1000 - time.time()
if not 0 < remaining <= 4:
    print('The owned license deadline expired before execution', file=sys.stderr)
    sys.exit(124)
deadline = time.monotonic() + remaining
pid, master = pty.fork()
if pid == 0:
    os.execv('/usr/bin/fm', ['/usr/bin/fm', 'license'])
data = bytearray()
status = None
timed_out = False
error = None

def read_available(timeout):
    if not select.select([master], [], [], timeout)[0]:
        return False
    try:
        chunk = os.read(master, 65536)
    except OSError as exc:
        if exc.errno == errno.EIO:
            return False
        raise
    data.extend(chunk)
    if len(data) > 1024 * 1024:
        raise RuntimeError('PTY output exceeded its limit')
    return bool(chunk)

try:
    os.write(master, b'yes\n')
    while True:
        waited, observed = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = observed
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        read_available(min(0.05, remaining))
except BaseException as exc:
    error = str(exc)
finally:
    if status is None:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
    try:
        while read_available(0):
            pass
    except BaseException as exc:
        error = error or str(exc)
    os.close(master)
code = os.waitstatus_to_exitcode(status)
print(json.dumps({
    'command': ['/usr/bin/fm', 'license'], 'pid': pid,
    'exitCode': code if code >= 0 else None,
    'signal': signal.Signals(-code).name if code < 0 else None,
    'stdout': data.decode('utf-8', errors='replace'), 'outputKind': 'merged-pty',
    'error': 'ETIMEDOUT' if timed_out else error,
}))
sys.exit(124 if timed_out else (1 if error else (code if code >= 0 else 128 - code)))
`;

/** Reserve one second of the outer five-second limit for reaping and sudo exit. */
export function appleModelCliAcceptanceArguments() {
  return [
    '-n',
    '/usr/bin/python3',
    '-I',
    '-S',
    '-c',
    FM_LICENSE_WATCHDOG,
    String(Date.now() + 4000),
  ];
}
