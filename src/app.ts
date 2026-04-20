import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import jwtPlugin from '@fastify/jwt';
import { env } from './config/env.js';
import { registerRoutes } from './routes/index.js';
import * as webhookController from './controllers/webhook.controller.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // ─── Security ────────────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = env.FRONTEND_URL.split(',').map((o) => o.trim());
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // ─── Plugins ──────────────────────────────────────────────────────────
  await app.register(jwtPlugin, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB max per file
    },
  });

  // ─── Global error handler ─────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError & { code?: string | number }, _req, reply) => {
    app.log.error(error);

    if (error.name === 'ZodError') {
      return reply.code(422).send({ error: 'Validation error', details: error.message });
    }
    if (error.message === 'Email already registered') {
      return reply.code(409).send({ error: error.message });
    }
    if (error.message === 'Invalid credentials') {
      return reply.code(401).send({ error: error.message });
    }
    if (error.name === 'CastError') {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }
    if (error.code === '11000' || (error as unknown as { code: number }).code === 11000) {
      return reply.code(409).send({ error: 'Duplicate entry — record already exists' });
    }

    return reply.code(error.statusCode ?? 500).send({
      error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  });

  // ─── Health check ─────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // ─── Webhook (public, raw body for signature verification) ────────────
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
    hook.post('/webhooks/resend', webhookController.handleResendWebhook);
  });

  // ─── Routes ───────────────────────────────────────────────────────────
  await app.register(
    async (api) => {
      await registerRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
