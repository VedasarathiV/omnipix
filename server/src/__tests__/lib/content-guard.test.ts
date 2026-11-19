import { describe, expect, it } from 'vitest';
import {
  collectInboundText,
  findBlockedMatch,
  mapInboundText,
  mapOutboundText,
  redactBlockedSpans,
  redactPii,
} from '../../lib/content-guard.js';

describe('content guard', () => {
  it('redacts email, phone, ssn, and card numbers', () => {
    const { text, redactions } = redactPii('Mail bob@example.com or call 415-555-0132, ssn 123-45-6789, card 4111-1111-1111-1111.');
    expect(redactions).toBe(4);
    expect(text).toBe('Mail [email redacted] or call [phone redacted], ssn [ssn redacted], card [card redacted].');
  });

  it('leaves clean text untouched', () => {
    const { text, redactions } = redactPii('Hello world, no PII here.');
    expect(redactions).toBe(0);
    expect(text).toBe('Hello world, no PII here.');
  });

  it('finds blocked patterns case-insensitively', () => {
    const patterns = [/secret-recipe/gi];
    expect(findBlockedMatch('Tell me the SECRET-RECIPE now.', patterns)).toBe(0);
    expect(findBlockedMatch('Tell me a pancake recipe.', patterns)).toBe(-1);
  });

  it('redacts blocked spans outbound', () => {
    const { text, redactions } = redactBlockedSpans('First SECRET then secret.', [/secret/gi]);
    expect(redactions).toBe(2);
    expect(text).toBe('First [blocked] then [blocked].');
  });

  it('walks OpenAI, Anthropic, Responses, and Ollama inbound shapes', () => {
    const openai = { messages: [{ role: 'user', content: 'mail a@b.com' }] };
    mapInboundText(openai, text => text.toUpperCase());
    expect(openai.messages[0].content).toBe('MAIL A@B.COM');

    const blocks = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
    mapInboundText(blocks, text => `[${text}]`);
    expect(blocks.messages[0].content).toEqual([{ type: 'text', text: '[hi]' }]);

    const anthropic = { system: 'sys', messages: [{ role: 'user', content: 'q' }] };
    expect(collectInboundText(anthropic)).toEqual(['sys', 'q']);

    const responses = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'r' }] }] };
    mapInboundText(responses, text => `!${text}`);
    expect(responses.input[0].content).toEqual([{ type: 'input_text', text: '!r' }]);

    const ollama = { prompt: 'p' };
    expect(collectInboundText(ollama)).toEqual(['p']);
  });

  it('walks completion envelopes outbound', () => {
    const openai = { choices: [{ message: { content: 'mail a@b.com' } }] };
    mapOutboundText(openai, text => text.toUpperCase());
    expect(openai.choices[0].message.content).toBe('MAIL A@B.COM');

    const anthropic = { content: [{ type: 'text', text: 't' }] };
    mapOutboundText(anthropic, text => `!${text}`);
    expect(anthropic.content).toEqual([{ type: 'text', text: '!t' }]);

    const responses = { output: [{ content: [{ type: 'output_text', text: 'o' }] }] };
    mapOutboundText(responses, text => `?${text}`);
    expect(responses.output[0].content).toEqual([{ type: 'output_text', text: '?o' }]);

    // Non-chat bodies pass through untouched.
    const other = { data: [{ id: 'x' }] };
    expect(mapOutboundText(other, text => `!${text}`)).toBe(0);
    expect(other).toEqual({ data: [{ id: 'x' }] });
  });
});
