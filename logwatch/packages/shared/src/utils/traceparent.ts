export interface TraceparentFields {
  version: string;
  traceId: string;
  spanId: string;
  traceFlags: number;
}

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header: string): TraceparentFields | null {
  const match = header.trim().toLowerCase().match(TRACEPARENT_REGEX);
  if (!match) return null;

  const [, version, traceId, spanId, flags] = match;
  if (traceId === '00000000000000000000000000000000') return null;
  if (spanId === '0000000000000000') return null;

  return {
    version: version!,
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: parseInt(flags!, 16),
  };
}

export function formatTraceparent(fields: TraceparentFields): string {
  return `${fields.version}-${fields.traceId}-${fields.spanId}-${fields.traceFlags.toString(16).padStart(2, '0')}`;
}

export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId) && traceId !== '00000000000000000000000000000000';
}

export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/.test(spanId) && spanId !== '0000000000000000';
}
