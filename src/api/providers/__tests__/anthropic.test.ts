// src/api/providers/__tests__/anthropic.test.ts
import { describe, it, expect } from 'vitest';
import { repairJson } from '../anthropic.js';

describe('repairJson', () => {
  it('returns empty object for empty/whitespace input', () => {
    expect(repairJson('')).toBe('{}');
    expect(repairJson('   ')).toBe('{}');
  });

  it('passes through valid JSON unchanged', () => {
    const input = '{"key": "value", "num": 42}';
    expect(repairJson(input)).toBe(input);
  });

  it('removes trailing commas in objects', () => {
    expect(repairJson('{"a": 1, "b": 2,}')).toBe('{"a": 1, "b": 2}');
  });

  it('removes trailing commas in arrays', () => {
    expect(repairJson('[1, 2, 3,]')).toBe('[1, 2, 3]');
  });

  it('converts single quotes to double quotes', () => {
    const result = repairJson("{'key': 'value'}");
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  it('removes line comments', () => {
    const input = '{ "a": 1 // comment\n, "b": 2 }';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes block comments', () => {
    const input = '{ "a": 1 /* comment */, "b": 2 }';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('adds missing closing braces', () => {
    const result = repairJson('{"a": 1');
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('adds missing closing brackets', () => {
    const result = repairJson('[1, 2, 3');
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('strips leading non-JSON text', () => {
    const input = 'Here is the JSON:\n{"a": 1}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('extracts tool arguments from MiMo explanation text', () => {
    const input = 'I will call the tool with:\n{"path": "src/index.tsx", "limit": 20,}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ path: 'src/index.tsx', limit: 20 });
  });

  it('preserves URLs while removing comments outside strings', () => {
    const input = '{ "url": "https://example.com/a//b", "ok": true // trailing note\n }';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ url: 'https://example.com/a//b', ok: true });
  });

  it('returns empty object for completely invalid input', () => {
    expect(repairJson('not json at all }}')).toBe('{}');
  });

  it('handles nested objects', () => {
    const input = '{"a": {"b": {"c": 1},},}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: { b: { c: 1 } } });
  });
});

describe('AnthropicProvider message conversion', () => {
  // We test the convertMessages logic indirectly through the public API
  // by importing the class and testing its behavior
  // Since convertMessages is private, we test the repairJson export and
  // verify the provider structure

  it('exports a class with expected interface', async () => {
    const { AnthropicProvider } = await import('../anthropic.js');
    const provider = new AnthropicProvider('test-key', 'http://localhost', 'test-model');
    expect(provider.name).toBe('anthropic');
    expect(typeof provider.chat).toBe('function');
    expect(typeof provider.streamChat).toBe('function');
    expect(typeof provider.abort).toBe('function');
  });

  it('tracks abort state until a new request starts', async () => {
    const { AnthropicProvider } = await import('../anthropic.js');
    const provider = new AnthropicProvider('test-key', 'http://localhost', 'test-model');
    expect(provider.isAborted).toBe(false);
    provider.abort();
    expect(provider.isAborted).toBe(true);
  });
});
