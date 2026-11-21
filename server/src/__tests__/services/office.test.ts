import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOffice, writeDocx, writePptx, writeXlsx } from '../../services/office.js';

// Office docs for agents: writers produce real files, the reader pulls the
// text back out. Roundtrips guard the exact flow read_office + write_* use.
describe('office service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnipix-office-'));

  it('writes and reads back a docx', async () => {
    const file = join(dir, 'memo.docx');
    const bytes = await writeDocx(file, [
      { style: 'h1', text: 'Launch Memo' },
      { style: 'p', text: 'Ship the purple button on Friday.' },
      { style: 'bullet', text: 'Verify the toast copy' },
    ]);
    expect(bytes).toBeGreaterThan(1000);
    const text = await readOffice(file);
    expect(text).toContain('Launch Memo');
    expect(text).toContain('purple button');
  });

  it('writes and reads back an xlsx', async () => {
    const file = join(dir, 'budget.xlsx');
    await writeXlsx(file, [
      { name: 'Q1', rows: [['item', 'cost'], ['widgets', '42'], ['gadgets', '17']] },
    ]);
    const text = await readOffice(file);
    expect(text).toContain('widgets');
    expect(text).toContain('42');
  });

  it('writes and reads back a pptx', async () => {
    const file = join(dir, 'pitch.pptx');
    await writePptx(file, 'Seed Round', [
      { title: 'Problem', bullets: ['Dial-up support queues'] },
      { title: 'Ask', bullets: ['Two engineers', 'One espresso machine'] },
    ]);
    const text = await readOffice(file);
    expect(text).toContain('Seed Round');
    expect(text).toContain('espresso machine');
  });

  it('rejects bad inputs without writing', async () => {
    await expect(writeDocx(join(dir, 'empty.docx'), [])).rejects.toThrow('1..500');
    await expect(writeDocx(join(dir, 'bad.docx'), [{ style: 'marquee', text: 'x' } as never])).rejects.toThrow('Bad docx style');
    await expect(writeXlsx(join(dir, 'bad.xlsx'), [])).rejects.toThrow('1..20');
    await expect(writePptx(join(dir, 'bad.pptx'), 't', [])).rejects.toThrow('1..100');
    await expect(readOffice(join(dir, 'missing.docx'))).rejects.toThrow('not found');
  });

  it('refuses non-office reads', async () => {
    await expect(readOffice(join(dir, 'notes.txt'))).rejects.toThrow('Unsupported office format');
  });
});
