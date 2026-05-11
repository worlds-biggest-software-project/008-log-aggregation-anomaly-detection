import type { FastifyInstance } from 'fastify';
import type { TraceSpan, SpanKind, SpanStatusCode } from '@logwatch/shared';
import { upsertService } from '../../services/service-registry.js';

const STREAM_KEY = 'logwatch:ingest:traces';
const MAX_BUFFER_SIZE = 100_000;

const SPAN_KIND_MAP: Record<number, SpanKind> = {
  0: 'INTERNAL',
  1: 'CLIENT',
  2: 'SERVER',
  3: 'PRODUCER',
  4: 'CONSUMER',
};

const STATUS_CODE_MAP: Record<number, SpanStatusCode> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

function extractAttributes(
  attrs: Array<{ key: string; value: Record<string, unknown> }> | undefined,
): {
  stringAttrs: Record<string, string>;
  numberAttrs: Record<string, number>;
  boolAttrs: Record<string, boolean>;
} {
  const stringAttrs: Record<string, string> = {};
  const numberAttrs: Record<string, number> = {};
  const boolAttrs: Record<string, boolean> = {};

  for (const attr of attrs ?? []) {
    const v = attr.value;
    if (v.stringValue !== undefined) {
      stringAttrs[attr.key] = String(v.stringValue);
    } else if (v.intValue !== undefined) {
      numberAttrs[attr.key] = Number(v.intValue);
    } else if (v.doubleValue !== undefined) {
      numberAttrs[attr.key] = Number(v.doubleValue);
    } else if (v.boolValue !== undefined) {
      boolAttrs[attr.key] = Boolean(v.boolValue);
    }
  }

  return { stringAttrs, numberAttrs, boolAttrs };
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: number; message?: string };
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
  events?: Array<{
    name?: string;
    timeUnixNano?: string;
    attributes?: Array<{ key: string; value: Record<string, unknown> }>;
  }>;
  links?: Array<{
    traceId?: string;
    spanId?: string;
  }>;
}

function nanoToIso(nanoStr: string | undefined): string {
  if (!nanoStr) return new Date(0).toISOString();
  const ms = Number(BigInt(nanoStr) / BigInt(1_000_000));
  return new Date(ms).toISOString();
}

export default async function otlpTracesRoute(fastify: FastifyInstance) {
  fastify.post('/traces', async (request, reply) => {
    const tenantId = request.tenantId;
    const body = request.body as {
      resourceSpans?: Array<{
        resource?: {
          attributes?: Array<{ key: string; value: Record<string, unknown> }>;
        };
        scopeSpans?: Array<{
          spans?: OtlpSpan[];
        }>;
      }>;
    };

    if (!body.resourceSpans?.length) {
      return reply.status(200).send({ partialSuccess: {} });
    }

    // Check backpressure
    const bufferLen = await fastify.redis.xlen(STREAM_KEY);
    if (bufferLen >= MAX_BUFFER_SIZE) {
      return reply.status(429).send({
        error: { code: 'BACKPRESSURE', message: 'Ingestion buffer full. Retry later.' },
      });
    }

    const spans: TraceSpan[] = [];
    const serviceNames = new Set<string>();

    for (const resourceSpan of body.resourceSpans) {
      const resourceAttributes: Record<string, string> = {};
      for (const attr of resourceSpan.resource?.attributes ?? []) {
        if (attr.value.stringValue !== undefined) {
          resourceAttributes[attr.key] = String(attr.value.stringValue);
        }
      }

      const serviceName = resourceAttributes['service.name'] ?? '';
      if (serviceName) serviceNames.add(serviceName);

      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        for (const span of scopeSpan.spans ?? []) {
          const { stringAttrs, numberAttrs, boolAttrs } = extractAttributes(span.attributes);

          const startNano = span.startTimeUnixNano ?? '0';
          const endNano = span.endTimeUnixNano ?? '0';
          const durationNs = Number(BigInt(endNano) - BigInt(startNano));
          const statusCode = STATUS_CODE_MAP[span.status?.code ?? 0] ?? 'UNSET';

          const eventsName: string[] = [];
          const eventsTimestamp: string[] = [];
          const eventsAttributes: Record<string, string>[] = [];

          for (const event of span.events ?? []) {
            eventsName.push(event.name ?? '');
            eventsTimestamp.push(nanoToIso(event.timeUnixNano));
            const eventAttrs: Record<string, string> = {};
            for (const attr of event.attributes ?? []) {
              if (attr.value.stringValue !== undefined) {
                eventAttrs[attr.key] = String(attr.value.stringValue);
              }
            }
            eventsAttributes.push(eventAttrs);
          }

          const linksTraceId: string[] = [];
          const linksSpanId: string[] = [];
          for (const link of span.links ?? []) {
            linksTraceId.push(link.traceId ?? '');
            linksSpanId.push(link.spanId ?? '');
          }

          const traceSpan: TraceSpan = {
            start_time: nanoToIso(span.startTimeUnixNano),
            end_time: nanoToIso(span.endTimeUnixNano),
            duration_ns: durationNs,
            tenant_id: tenantId,
            trace_id: span.traceId ?? '',
            span_id: span.spanId ?? '',
            parent_span_id: span.parentSpanId ?? '',
            operation_name: span.name ?? '',
            service_name: serviceName,
            span_kind: SPAN_KIND_MAP[span.kind ?? 0] ?? 'INTERNAL',
            status_code: statusCode,
            status_message: span.status?.message ?? '',
            resource_string: resourceAttributes,
            span_attributes_string: stringAttrs,
            span_attributes_number: numberAttrs,
            span_attributes_bool: boolAttrs,
            events_name: eventsName,
            events_timestamp: eventsTimestamp,
            events_attributes: eventsAttributes,
            links_trace_id: linksTraceId,
            links_span_id: linksSpanId,
            has_error: statusCode === 'ERROR',
          };

          spans.push(traceSpan);
        }
      }
    }

    const pipeline = fastify.redis.pipeline();
    for (const span of spans) {
      pipeline.xadd(STREAM_KEY, '*', 'data', JSON.stringify(span));
    }
    await pipeline.exec();

    for (const svcName of serviceNames) {
      upsertService(fastify.pg, tenantId, svcName).catch(() => {});
    }

    return reply.status(200).send({ partialSuccess: {} });
  });
}
