// Ruflo #3164: bounded observations of the existing native transaction only.
// Serialized into policy-runtime.js, which already imports these native helpers.
export function policyDiagnostic(projectRoot, lockPath, details) {
  const started = Date.now();
  const hash = value => createHash('sha256').update(String(value)).digest('hex');
  const row = { schemaVersion: 1, invocation: randomUUID(), pid: process.pid,
    project: hash(resolve(projectRoot)).slice(0, 16), startedAt: new Date(started).toISOString(), phases: [] };
  row.operations = (Array.isArray(details) ? details : [details]).slice(0, 32).flatMap(detail => {
    if (!detail || typeof detail !== 'object') return [];
    return [{ tool: /^[a-z0-9_-]{1,80}$/.test(detail.tool) ? detail.tool : undefined,
      inputDigest: /^sha256:[a-f0-9]{64}$/.test(detail.inputDigest) ? detail.inputDigest : undefined }];
  });
  const fileName = 'transaction-' + (parseInt(hash(row.invocation).slice(0, 8), 16) % 128) + '.json';
  return (phase, error) => {
    if (process.env.RSP_POLICY_DIAGNOSTICS === 'off') return;
    let fd;
    try {
      const event = { phase, elapsedMs: Date.now() - started };
      if (phase === 'waiting' || phase === 'failed') {
        try { const owner = JSON.parse(readLockFile(lockPath));
          if (Number.isSafeInteger(owner.pid)) event.lockOwnerPid = owner.pid;
          if (Number.isSafeInteger(owner.acquiredAt)) event.lockAgeMs = Date.now() - owner.acquiredAt;
        } catch { /* absent or changing lock; never touch it */ }
      }
      if (error) event.error = /^policy-[a-z0-9-]+(?=:|$)/.exec(String(error.message))?.[0] ?? 'native-operation-error';
      if (row.phases.length < 16) row.phases.push(event);
      let dir = userInfo().homedir;
      for (const part of ['.ruflo-source-patch', 'policy-diagnostics']) {
        dir = join(dir, part);
        try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        const stat = lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (part === 'policy-diagnostics' && (stat.mode & 0o077))
            || (process.getuid && stat.uid !== process.getuid())) return;
      }
      const file = join(dir, fileName);
      try { const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)
            || (process.getuid && stat.uid !== process.getuid())) return;
      } catch (e) { if (e.code !== 'ENOENT') return; }
      fd = openSync(file, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
      writeFileSync(fd, JSON.stringify(row) + '\n');
    } catch { /* Diagnostics never change native authorization or its outcome. */ }
    finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  };
}
