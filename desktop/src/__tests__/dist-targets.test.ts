import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Studio is the shipped UI: every desktop:dist* target must build it, because
// stage-client.mjs stages studio/dist into the package. The mac:x64/win/linux
// scripts used to build client/ instead, shipping a stale studio bundle (or
// failing on a clean checkout). desktop:dev intentionally still builds
// client/: dev mode loads repoRoot/client/dist directly (main.ts).
describe('desktop build targets ship studio', () => {
  const root = fileURLToPath(new URL('../../../package.json', import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(root, 'utf8')) as { scripts: Record<string, string> };

  it('every desktop:dist* script builds the studio workspace', () => {
    const distScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith('desktop:dist'));
    expect(distScripts.length).toBeGreaterThanOrEqual(4);
    for (const [name, cmd] of distScripts) {
      expect(cmd, `${name} must build studio`).toContain('build -w studio');
      expect(cmd, `${name} must not build client`).not.toContain('build -w client');
    }
  });

  it('stage-client stages the studio build', () => {
    const stage = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/stage-client.mjs'),
      'utf8',
    );
    expect(stage).toContain('studio/dist');
  });
});
