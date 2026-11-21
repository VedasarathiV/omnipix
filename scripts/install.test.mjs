import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import assert from 'node:assert/strict';

const execFile = promisify(execFileCallback);
const projectRoot = resolve(import.meta.dirname, '..');
const script = join(projectRoot, 'install.sh');

async function run(args, env = process.env) {
  try {
    const { stdout } = await execFile(script, args, { env });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('install.sh passes bash syntax check', async () => {
  const { stdout } = await execFile('bash', ['-n', script]);
  assert.equal(stdout, '');
});

test('--help explains both modes', async () => {
  const { code, out } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(out, /Usage: install\.sh/);
  assert.match(out, /--docker/);
  assert.match(out, /--cli/);
});

test('unknown flag fails loudly', async () => {
  const { code, out } = await run(['--nope']);
  assert.notEqual(code, 0);
  assert.match(out, /unknown option '--nope'/);
});

test('--docker without docker gives a sentence, not a trace', async () => {
  const env = { ...process.env, PATH: '/usr/bin:/bin' };
  const { code, out } = await run(['--docker'], env);
  assert.notEqual(code, 0);
  assert.match(out, /docker is required/);
});

test('--cli refuses Node < 22', async t => {
  const bin = await mkdtemp(join(tmpdir(), 'omnipix-install-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(bin, { recursive: true, force: true });
  });
  await writeFile(join(bin, 'node'), '#!/bin/sh\necho v18.9.0\n');
  await chmod(join(bin, 'node'), 0o755);
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
  const { code, out } = await run(['--cli'], env);
  assert.notEqual(code, 0);
  assert.match(out, /needs Node\.js 22 or newer \(found 18\.9\.0\)/);
});

test('--cli reports the installer source repo', async () => {
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(script, 'utf8');
  assert.match(body, /github\.com\/VedasarathiV\/omnipix\.git/);
  assert.doesNotMatch(body, /YOUR-GITHUB-USER/);
});
