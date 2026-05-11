import type { FastifyInstance } from 'fastify';
import { requireViewer } from '../plugins/rbac.js';
import { LLMClient } from '../services/llm-client.js';
import { NLQueryService } from '../services/nl-query.js';

export default async function aiRoutes(fastify: FastifyInstance) {
  const llmClient = new LLMClient();
  const nlQueryService = new NLQueryService(llmClient);

  // POST /query — execute a natural language query
  fastify.post('/query', {
    preHandler: requireViewer,
    schema: {
      body: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 3, maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { question } = request.body as { question: string };

    try {
      const result = await nlQueryService.translateAndExecute({
        question,
        tenantId: request.tenantId,
        userId: request.userId,
        pg: fastify.pg,
        ch: fastify.clickhouse,
      });

      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      return reply.code(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message,
      });
    }
  });

  // GET /query/history — list past NL queries for the user
  fastify.get('/query/history', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { limit = 20, offset = 0 } = request.query as {
      limit?: number;
      offset?: number;
    };

    const [countResult, dataResult] = await Promise.all([
      fastify.pg.query(
        'SELECT COUNT(*) AS total FROM nl_queries WHERE tenant_id = $1 AND user_id = $2',
        [request.tenantId, request.userId],
      ),
      fastify.pg.query(
        'SELECT * FROM nl_queries WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
        [request.tenantId, request.userId, limit, offset],
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return reply.send({
      data: dataResult.rows,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  });
}
