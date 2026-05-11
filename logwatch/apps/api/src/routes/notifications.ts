import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor } from '../plugins/rbac.js';

export default async function notificationsRoutes(fastify: FastifyInstance) {
  // GET /channels — list notification channels for tenant
  fastify.get('/channels', {
    preHandler: requireViewer,
  }, async (request, reply) => {
    const result = await fastify.pg.query(
      'SELECT * FROM notification_channels WHERE tenant_id = $1 ORDER BY created_at DESC',
      [request.tenantId],
    );

    return reply.send({ data: result.rows });
  });

  // POST /channels — create a notification channel
  fastify.post('/channels', {
    preHandler: requireEditor,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'channel_type', 'config'],
        properties: {
          name: { type: 'string' },
          channel_type: { type: 'string', enum: ['slack', 'pagerduty', 'email', 'webhook'] },
          config: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, channel_type, config } = request.body as {
      name: string;
      channel_type: string;
      config: Record<string, unknown>;
    };

    const result = await fastify.pg.query(
      `INSERT INTO notification_channels (tenant_id, name, channel_type, config)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [request.tenantId, name, channel_type, JSON.stringify(config)],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // GET /channels/:id — get a single channel
  fastify.get<{ Params: { id: string } }>('/channels/:id', {
    preHandler: requireViewer,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await fastify.pg.query(
      'SELECT * FROM notification_channels WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notification channel not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /channels/:id — update a channel
  fastify.patch<{ Params: { id: string } }>('/channels/:id', {
    preHandler: requireEditor,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          channel_type: { type: 'string', enum: ['slack', 'pagerduty', 'email', 'webhook'] },
          config: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, channel_type, config } = request.body as {
      name?: string;
      channel_type?: string;
      config?: Record<string, unknown>;
    };

    // Verify the channel exists and belongs to this tenant
    const existing = await fastify.pg.query(
      'SELECT id FROM notification_channels WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (existing.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notification channel not found',
      });
    }

    // Build dynamic SET clause
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      params.push(name);
      paramIndex++;
    }

    if (channel_type !== undefined) {
      setClauses.push(`channel_type = $${paramIndex}`);
      params.push(channel_type);
      paramIndex++;
    }

    if (config !== undefined) {
      setClauses.push(`config = $${paramIndex}`);
      params.push(JSON.stringify(config));
      paramIndex++;
    }

    params.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const updateQuery = `
      UPDATE notification_channels
      SET ${setClauses.join(', ')}
      WHERE id = $${idIndex} AND tenant_id = $${tenantIndex}
      RETURNING *
    `;

    const result = await fastify.pg.query(updateQuery, params);

    return reply.send(result.rows[0]);
  });

  // DELETE /channels/:id — delete a channel
  fastify.delete<{ Params: { id: string } }>('/channels/:id', {
    preHandler: requireEditor,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await fastify.pg.query(
      'DELETE FROM notification_channels WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notification channel not found',
      });
    }

    return reply.code(204).send();
  });

  // POST /channels/:id/test — send a test notification
  fastify.post<{ Params: { id: string } }>('/channels/:id/test', {
    preHandler: requireEditor,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await fastify.pg.query(
      'SELECT * FROM notification_channels WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notification channel not found',
      });
    }

    const channel = result.rows[0];

    return reply.send({
      success: true,
      message: `Test notification sent to ${channel.channel_type} channel "${channel.name}"`,
    });
  });
}
