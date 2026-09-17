// tsx asks Node for process.geteuid() when it exists and falls back to
// os.userInfo() on Windows. Node 24 can make os.userInfo() fail with ENOMEM
// even when enough memory is available. Providing the Unix-compatible value
// before tsx is imported avoids that platform-specific lookup.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 0,
  });
}
