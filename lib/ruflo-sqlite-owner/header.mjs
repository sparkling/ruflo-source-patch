// ruvnet/ruflo#4040: closing any raw descriptor for a live SQLite inode
// releases this process's POSIX locks, including locks held by SQLite.
export const HEADER_ANCHOR = `function readHeaderBytes(filePath, len) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(len);
        const bytesRead = fs.readSync(fd, buf, 0, len, 0);
        return buf.subarray(0, bytesRead);
    }
    finally {
        fs.closeSync(fd);
    }
}`;
export const HEADER_REPLACEMENT = `function readHeaderBytes(filePath, len) {
    // ruflo-source-patch (#4040): exec a fresh process; never close a raw
    // descriptor in the process that owns live SQLite advisory locks.
    if (!Number.isSafeInteger(len) || len < 1 || len > 100)
        throw new Error('Invalid SQLite header length');
    return __rspHeaderExec(process.execPath, ['--input-type=commonjs', '-e',
        "const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'r');" +
        "try{const b=Buffer.alloc(Number(process.argv[2]));const n=fs.readSync(fd,b,0,b.length,0);process.stdout.write(b.subarray(0,n));}finally{fs.closeSync(fd);}",
        filePath, String(len)], {
        timeout: 5000, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'],
        env: {}, windowsHide: true,
    });
}`;
export const GRAPH_HEADER_ENTRY = {
  id: 'memory/graph-header-process', target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'graph-edge-writer.js'],
  appliesWhen: 'function readHeaderBytes(filePath, len)',
  edits: [
    { find: "import * as fs from 'fs';", replace: "import * as fs from 'fs';\nimport { execFileSync as __rspHeaderExec } from 'node:child_process';" },
    { find: HEADER_ANCHOR, replace: HEADER_REPLACEMENT },
  ],
};
