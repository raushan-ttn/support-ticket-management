import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import request from 'supertest';
import { z, ZodError } from 'zod';

import errorHandler from './errorHandler';

// Helper: build a minimal Express app that triggers a given error via next(err)
function makeApp(err: unknown) {
  const app = express();
  app.use(express.json());
  app.get('/trigger', (_req: Request, _res: Response, next: NextFunction) => next(err));
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  describe('multer.MulterError handling', () => {
    it('maps LIMIT_FILE_SIZE → 400 VALIDATION_ERROR with correct message', async () => {
      const multerErr = new multer.MulterError('LIMIT_FILE_SIZE');
      const res = await request(makeApp(multerErr)).get('/trigger');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toBe('File exceeds the maximum allowed size');
    });

    it('maps LIMIT_FILE_COUNT → 400 VALIDATION_ERROR with correct message', async () => {
      const multerErr = new multer.MulterError('LIMIT_FILE_COUNT');
      const res = await request(makeApp(multerErr)).get('/trigger');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toBe('Too many files in a single request');
    });

    it('maps LIMIT_UNEXPECTED_FILE → 400 VALIDATION_ERROR with correct message', async () => {
      const multerErr = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
      const res = await request(makeApp(multerErr)).get('/trigger');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toBe('Unexpected file field name');
    });

    it('maps any other MulterError code → 400 VALIDATION_ERROR with err.message', async () => {
      const multerErr = new multer.MulterError('LIMIT_PART_COUNT');
      const res = await request(makeApp(multerErr)).get('/trigger');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      // multer.MulterError sets .message to the code by default
      expect(typeof res.body.message).toBe('string');
    });
  });

  describe('ZodError handling', () => {
    it('maps ZodError → 400 VALIDATION_ERROR with formatted path:message string', async () => {
      let zodErr: ZodError;
      try {
        z.object({ name: z.string().min(1) }).parse({});
      } catch (e) {
        zodErr = e as ZodError;
        const res = await request(makeApp(zodErr)).get('/trigger');

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.message).toContain('name');
      }
    });

    it('falls back to "body" when the ZodError issue has an empty path', async () => {
      // z.string() on a plain value produces an issue with path []
      let zodErr: ZodError;
      try {
        z.string().min(1).parse(42);
      } catch (e) {
        zodErr = e as ZodError;
        const res = await request(makeApp(zodErr)).get('/trigger');

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('body:');
      }
    });
  });

  describe('domain error handling', () => {
    it('returns 404 with code NOT_FOUND for a domain 404 error', async () => {
      const err = Object.assign(new Error('Not found'), { statusCode: 404, code: 'NOT_FOUND' });
      const res = await request(makeApp(err)).get('/trigger');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toBe('Not found');
    });

    it('returns 409 with code INVALID_STATUS_TRANSITION for a domain 409 error', async () => {
      const err = Object.assign(new Error('Invalid transition'), {
        statusCode: 409,
        code: 'INVALID_STATUS_TRANSITION',
      });
      const res = await request(makeApp(err)).get('/trigger');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('returns 500 for a generic Error with no statusCode', async () => {
      const err = new Error('boom');
      const res = await request(makeApp(err)).get('/trigger');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('NODE_ENV-dependent masking', () => {
    const ORIGINAL_ENV = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_ENV;
    });

    it('masks 500 message as "Internal Server Error" in production', async () => {
      process.env.NODE_ENV = 'production';
      // Re-require so the new NODE_ENV is picked up by config
      jest.resetModules();
      const { default: prodErrorHandler } = await import('./errorHandler');

      const app = express();
      app.get('/trigger', (_req, _res, next) => next(new Error('secret internal details')));
      app.use(prodErrorHandler);

      const res = await request(app).get('/trigger');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.message).not.toContain('secret');
    });

    it('does NOT mask the message for client (4xx) errors in production', async () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const { default: prodErrorHandler } = await import('./errorHandler');

      const err = Object.assign(new Error('Bad request detail'), { statusCode: 400 });
      const app = express();
      app.get('/trigger', (_req, _res, next) => next(err));
      app.use(prodErrorHandler);

      const res = await request(app).get('/trigger');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Bad request detail');
    });
  });

  describe('stack field behaviour', () => {
    it('includes stack field in development mode', async () => {
      // NODE_ENV is "test" in the Jest environment; in test mode (not development) stack
      // is NOT included.  We need to re-import with env=development.
      const ORIGINAL = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const { default: devErrorHandler } = await import('./errorHandler');

      const app = express();
      app.get('/trigger', (_req, _res, next) => next(new Error('dev error')));
      app.use(devErrorHandler);

      const res = await request(app).get('/trigger');

      expect(res.body.stack).toBeDefined();

      process.env.NODE_ENV = ORIGINAL;
      jest.resetModules();
    });
  });

  describe('code field in response', () => {
    it('omits code key when error has no code property', async () => {
      const err = Object.assign(new Error('generic'), { statusCode: 400 });
      const res = await request(makeApp(err)).get('/trigger');

      expect(res.body).not.toHaveProperty('code');
    });

    it('includes code key when error has a code property', async () => {
      const err = Object.assign(new Error('forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
      const res = await request(makeApp(err)).get('/trigger');

      expect(res.body.code).toBe('FORBIDDEN');
    });
  });
});
