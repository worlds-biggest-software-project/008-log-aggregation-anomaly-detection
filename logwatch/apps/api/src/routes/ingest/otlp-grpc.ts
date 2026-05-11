import type { FastifyInstance } from 'fastify';

export default async function otlpGrpcRoute(fastify: FastifyInstance) {
  // OTLP gRPC ingestion for logs and traces
  // Requires: @grpc/grpc-js, @grpc/proto-loader
  // Proto files: opentelemetry/proto/collector/logs/v1/logs_service.proto
  //              opentelemetry/proto/collector/trace/v1/trace_service.proto
  //
  // This endpoint will be registered separately from the HTTP server
  // using grpc.Server on a dedicated port (typically 4317).
  //
  // Implementation plan:
  // 1. Load proto definitions using @grpc/proto-loader
  // 2. Create gRPC server with ExportLogsServiceRequest and ExportTraceServiceRequest handlers
  // 3. Convert protobuf messages to the same format as HTTP OTLP endpoints
  // 4. Feed into the same Redis Stream pipeline (logwatch:ingest:logs, logwatch:ingest:traces)

  fastify.log.info('OTLP gRPC endpoint registered (stub — HTTP OTLP endpoints are active)');
}
