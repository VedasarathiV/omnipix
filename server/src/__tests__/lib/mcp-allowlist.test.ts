import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_COMMANDS,
  isMcpCommandAllowed,
  parseMcpAllowlist,
} from '../../lib/mcp-allowlist.js';

describe('mcp allowlist matching', () => {
  it('matches exact commands and basenames', () => {
    const list = ['npx', 'python3'];
    expect(isMcpCommandAllowed('npx', list)).toBe(true);
    expect(isMcpCommandAllowed('/usr/local/bin/python3', list)).toBe(true);
    expect(isMcpCommandAllowed('C:\\Python\\python.exe', ['python.exe'])).toBe(true);
    expect(isMcpCommandAllowed('/bin/sh', list)).toBe(false);
    expect(isMcpCommandAllowed('curl', list)).toBe(false);
    expect(isMcpCommandAllowed('  ', list)).toBe(false);
    expect(isMcpCommandAllowed('npxx', list)).toBe(false);
  });

  it('is case-sensitive and denies on empty lists', () => {
    expect(isMcpCommandAllowed('NPX', ['npx'])).toBe(false);
    expect(isMcpCommandAllowed('npx', [])).toBe(false);
  });

  it('ships a common-runtimes default', () => {
    for (const cmd of ['npx', 'node', 'python3', 'python', 'uvx']) {
      expect(isMcpCommandAllowed(cmd, DEFAULT_MCP_COMMANDS)).toBe(true);
    }
    expect(isMcpCommandAllowed('/bin/sh', DEFAULT_MCP_COMMANDS)).toBe(false);
  });

  it('parses stored lists defensively', () => {
    expect(parseMcpAllowlist(undefined)).toBeNull();
    expect(parseMcpAllowlist('not json')).toBeNull();
    expect(parseMcpAllowlist('{"a":1}')).toBeNull();
    expect(parseMcpAllowlist('[]')).toEqual([]);
    expect(parseMcpAllowlist('["npx",42,"  "]')).toEqual(['npx']);
  });
});
