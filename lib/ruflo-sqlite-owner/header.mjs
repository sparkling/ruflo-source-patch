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
// Native Ruflo 3.56.6 implements #4040. Exact reviewed bytes; drift refuses retirement.
export const NATIVE_HEADER = "const HEADER_READER = \"const fs=require('fs');const fd=fs.openSync(process.argv[1],'r');const b=Buffer.alloc(Number(process.argv[2]));\" +\n    \"const n=fs.readSync(fd,b,0,b.length,0);process.stdout.write(b.subarray(0,n).toString('hex'))\";\nconst HEADER_READ_TIMEOUT_MS = 5000;\n/** Read just the first `len` bytes of a file without loading the whole file\n * into memory.\n *\n * #4040: on POSIX this never opens the file in THIS process. close(2) on any\n * descriptor for an inode drops every advisory lock the process holds on it\n * (https://www.sqlite.org/howtocorrupt.html), including the ones SQLite's own\n * live handle holds - a second process then believes it is the only\n * connection and checkpoints/deletes the WAL under us. This module (and the\n * shared AgentDB handle) can own such a handle, so the header is read by a\n * short-lived child: empty environment, one bounded read, 5 s timeout. Windows\n * byte-range locks are per handle, not per process, so it reads in-process. */\nfunction readHeaderBytes(filePath, len) {\n    if (process.platform === 'win32') {\n        const fd = fs.openSync(filePath, 'r');\n        try {\n            const buf = Buffer.alloc(len);\n            const bytesRead = fs.readSync(fd, buf, 0, len, 0);\n            return buf.subarray(0, bytesRead);\n        }\n        finally {\n            fs.closeSync(fd);\n        }\n    }\n    const hex = execFileSync(process.execPath, ['-e', HEADER_READER, filePath, String(len)], {\n        env: {},\n        timeout: HEADER_READ_TIMEOUT_MS,\n        maxBuffer: len * 2 + 64,\n        stdio: ['ignore', 'pipe', 'ignore'],\n        encoding: 'utf8',\n    });\n    return Buffer.from(hex, 'hex');\n}\n";
export const nativeHeaderSatisfied = source =>
  source.split(NATIVE_HEADER).length === 2
  && source.split("import { execFileSync } from 'child_process';").length === 2;
export const GRAPH_HEADER_ENTRY = {
  id: 'memory/graph-header-process', target: 'memory',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'graph-edge-writer.js'],
  appliesWhen: 'function readHeaderBytes(filePath, len)',
  nativeSatisfied: nativeHeaderSatisfied,
  edits: [
    { find: "import * as fs from 'fs';", replace: "import * as fs from 'fs';\nimport { execFileSync as __rspHeaderExec } from 'node:child_process';" },
    { find: HEADER_ANCHOR, replace: HEADER_REPLACEMENT },
  ],
};
