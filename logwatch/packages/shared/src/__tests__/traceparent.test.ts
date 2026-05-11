import { describe, it, expect } from 'vitest';
import { parseTraceparent } from '../utils/traceparent.js';

describe('parseTraceparent', () => {
  it('parses valid traceparent header', () => {
    const result = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

    expect(result).not.toBeNull();
    expect(result!.version).toBe('00');
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(result!.spanId).toBe('00f067aa0ba902b7');
    expect(result!.traceFlags).toBe(1);
  });

  it('returns null for invalid format', () => {
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(parseTraceparent('00-short-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-short-01')).toBeNull();
    expect(parseTraceparent('zz-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull(); // non-hex chars in version
  });

  it('returns null for all-zero trace ID', () => {
    const result = parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01');
    expect(result).toBeNull();
  });

  it('returns null for all-zero span ID', () => {
    const result = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01');
    expect(result).toBeNull();
  });

  it('extracts version, traceId, parentId, traceFlags correctly', () => {
    const result = parseTraceparent('01-abcdef1234567890abcdef1234567890-fedcba0987654321-00');

    expect(result).not.toBeNull();
    expect(result!.version).toBe('01');
    expect(result!.traceId).toBe('abcdef1234567890abcdef1234567890');
    expect(result!.spanId).toBe('fedcba0987654321');
    expect(result!.traceFlags).toBe(0);
  });

  it('handles uppercase input by normalizing to lowercase', () => {
    const result = parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01');

    expect(result).not.toBeNull();
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(result!.spanId).toBe('00f067aa0ba902b7');
  });

  it('trims whitespace from input', () => {
    const result = parseTraceparent('  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  ');

    expect(result).not.toBeNull();
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('parses traceFlags as hex integer', () => {
    const result = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-ff');

    expect(result).not.toBeNull();
    expect(result!.traceFlags).toBe(255);
  });
});
