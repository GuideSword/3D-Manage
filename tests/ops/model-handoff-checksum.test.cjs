const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const script = path.resolve(__dirname, '../../tools/model-handoff/Verify-Checksum.ps1');
const quote = s => "'" + s.replaceAll("'", "''") + "'";
test('Windows PowerShell interactive checksum waits after success and errors', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'handoff-checksum-'));
  const archive = path.join(dir, 'package.zip');
  const sums = path.join(dir, 'SHA256SUMS');
  const hash = createHash('sha256').update('fixture').digest('hex');
  writeFileSync(archive, 'fixture');
  writeFileSync(sums, `${hash}  package.zip\n`);
  try {
    for (const input of [archive, path.join(dir, 'missing.zip')]) {
      await new Promise((resolve, reject) => {
        const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; & ${quote(script)} -ChecksumFile ${quote(sums)}`;
        const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
        let output = '', paused = false;
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${output}`)); }, 8000);
        child.stdout.on('data', chunk => {
          output += chunk.toString('utf8');
          if (!paused && output.includes('按回车关闭窗口')) {
            paused = true;
            setTimeout(() => { if (child.exitCode === null) child.stdin.end('\n'); }, 200);
          }
        });
        child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
        child.on('error', reject);
        child.on('close', code => {
          clearTimeout(timer);
          try {
            assert.ok(paused, `Exited before user confirmation: ${output}`);
            assert.equal(code, input === archive ? 0 : 1, output);
            if (input === archive) assert.ok(output.includes(hash), output);
            resolve();
          } catch (error) { reject(error); }
        });
        child.stdin.write(input + '\n');
      });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
