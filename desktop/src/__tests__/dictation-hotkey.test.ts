import { describe, expect, it, vi } from 'vitest';
import { DICTATION_ACCELERATORS, formatAccelerator, registerDictationHotkey } from '../dictation-hotkey.js';

describe('dictation hotkey registration', () => {
  it('takes the first free accelerator', () => {
    const register = vi.fn().mockReturnValue(true);
    const onToggle = vi.fn();
    expect(registerDictationHotkey(register, onToggle)).toBe(DICTATION_ACCELERATORS[0]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(DICTATION_ACCELERATORS[0], onToggle);
  });

  it('falls through taken accelerators to the next candidate', () => {
    const register = vi.fn()
      .mockReturnValueOnce(false)
      .mockImplementationOnce(() => { throw new Error('taken'); })
      .mockReturnValue(true);
    expect(registerDictationHotkey(register, vi.fn())).toBe(DICTATION_ACCELERATORS[2]);
    expect(register).toHaveBeenCalledTimes(3);
  });

  it('returns null when every candidate is taken', () => {
    expect(registerDictationHotkey(vi.fn().mockReturnValue(false), vi.fn())).toBeNull();
  });
});

describe('formatAccelerator', () => {
  it('renders mac glyphs on darwin', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space', 'darwin')).toBe('⌘⇧Space');
    expect(formatAccelerator('CommandOrControl+Alt+D', 'darwin')).toBe('⌘⌥D');
  });

  it('renders Ctrl combos elsewhere', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space', 'win32')).toBe('Ctrl+Shift+Space');
    expect(formatAccelerator('CommandOrControl+Shift+Space', 'linux')).toBe('Ctrl+Shift+Space');
  });
});
