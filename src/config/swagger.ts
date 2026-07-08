import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

import config from './index';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Support Ticket Management API',
      version: '1.0.0',
      description: 'REST API for creating, assigning, and resolving support tickets.',
    },
    servers: [
      {
        url: `http://localhost:${config.port}/api/v1`,
        description: 'Local',
      },
    ],
    tags: [
      { name: 'Health', description: 'Service liveness' },
      { name: 'Auth', description: 'Login and current-session identity' },
      { name: 'Tickets', description: 'Ticket lifecycle: create, list, update, assign, transition status' },
      { name: 'Comments', description: 'Ticket comments (with inline attachments)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Resource not found' },
            code: { type: 'string', example: 'NOT_FOUND' },
          },
        },
        AuthUser: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Super Admin' },
            email: { type: 'string', format: 'email', example: 'admin@ttn.com' },
            role: { type: 'string', enum: ['ADMIN', 'AGENT'] },
            status: { type: 'string', enum: ['ACTIVE', 'BLOCKED'] },
          },
        },
        AttachmentRow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            commentId: { type: 'string', format: 'uuid', nullable: true },
            filename: { type: 'string', example: 'screenshot.png' },
            mimeType: { type: 'string', example: 'image/png' },
            sizeBytes: { type: 'integer', example: 20480 },
            uploadedBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            url: { type: 'string', format: 'uri' },
          },
        },
        TicketRow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string', example: 'Login page returns 500' },
            description: { type: 'string', example: 'Steps to reproduce...' },
            type: { type: 'string', nullable: true, example: 'BUG' },
            subType: { type: 'string', nullable: true, example: 'AUTH' },
            screenshot: { type: 'string', format: 'uri', nullable: true },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            status: {
              type: 'string',
              enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'],
            },
            assignedTo: { type: 'string', format: 'uuid' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            attachments: {
              type: 'array',
              items: { $ref: '#/components/schemas/AttachmentRow' },
            },
          },
        },
        TicketListResult: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              items: { $ref: '#/components/schemas/TicketRow' },
            },
            total: { type: 'integer', example: 42 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
          },
        },
        CommentRow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            message: { type: 'string', example: 'Looking into this now.' },
            screenshot: { type: 'string', format: 'uri', nullable: true },
            createdBy: { type: 'string', format: 'uuid' },
            createdByName: { type: 'string', example: 'Jane Agent' },
            createdAt: { type: 'string', format: 'date-time' },
            attachments: {
              type: 'array',
              items: { $ref: '#/components/schemas/AttachmentRow' },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid bearer token',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        Forbidden: {
          description: 'Caller lacks permission for this action',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        NotFound: {
          description: 'Resource does not exist',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
        ValidationError: {
          description: 'Zod validation failure',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [
    path.join(__dirname, '../app.{ts,js}'),
    path.join(__dirname, '../modules/**/*.routes.{ts,js}'),
  ],
};

export default swaggerJsdoc(options);
