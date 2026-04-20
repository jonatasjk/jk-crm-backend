import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.middleware.js';
import * as authController from '../controllers/auth.controller.js';
import * as investorController from '../controllers/investor.controller.js';
import * as partnerController from '../controllers/partner.controller.js';
import * as emailController from '../controllers/email.controller.js';
import * as materialController from '../controllers/material.controller.js';
import * as sequenceController from '../controllers/sequence.controller.js';

export async function registerRoutes(app: FastifyInstance) {
  // ─── Auth (public) ───────────────────────────────────────────────────
  app.post('/auth/register', authController.register);
  app.post('/auth/login', authController.login);
  app.get('/auth/me', { preHandler: [authenticate] }, authController.me);
  app.post('/auth/change-password', { preHandler: [authenticate] }, authController.changePasswordHandler);
  app.post('/auth/forgot-password', authController.forgotPassword);
  app.post('/auth/reset-password', authController.resetPassword);

  // ─── Investors ───────────────────────────────────────────────────────
  app.get('/investors', { preHandler: [authenticate] }, investorController.list);
  app.get<{ Params: { id: string } }>('/investors/:id', { preHandler: [authenticate] }, investorController.getOne);
  app.post('/investors', { preHandler: [authenticate] }, investorController.create);
  app.put<{ Params: { id: string } }>('/investors/:id', { preHandler: [authenticate] }, investorController.update);
  app.delete<{ Params: { id: string } }>('/investors/:id', { preHandler: [authenticate] }, investorController.remove);
  app.post('/investors/import', { preHandler: [authenticate] }, investorController.importCsv);

  // ─── Partners ────────────────────────────────────────────────────────
  app.get('/partners', { preHandler: [authenticate] }, partnerController.list);
  app.get<{ Params: { id: string } }>('/partners/:id', { preHandler: [authenticate] }, partnerController.getOne);
  app.post('/partners', { preHandler: [authenticate] }, partnerController.create);
  app.put<{ Params: { id: string } }>('/partners/:id', { preHandler: [authenticate] }, partnerController.update);
  app.delete<{ Params: { id: string } }>('/partners/:id', { preHandler: [authenticate] }, partnerController.remove);
  app.post('/partners/import', { preHandler: [authenticate] }, partnerController.importCsv);

  // ─── Email ───────────────────────────────────────────────────────────
  app.post('/email/send', { preHandler: [authenticate] }, emailController.send);
  app.get('/email/stats', { preHandler: [authenticate] }, emailController.stats);
  app.get('/email/logs', { preHandler: [authenticate] }, emailController.listAll);
  app.get<{ Params: { entityType: string; entityId: string } }>('/email/logs/:entityType/:entityId', { preHandler: [authenticate] }, emailController.logs);

  // ─── Materials ───────────────────────────────────────────────────────
  app.post('/materials/upload', { preHandler: [authenticate] }, materialController.upload);
  app.get('/materials', { preHandler: [authenticate] }, materialController.list);
  app.get<{ Params: { id: string } }>('/materials/:id/download', { preHandler: [authenticate] }, materialController.download);
  app.delete<{ Params: { id: string } }>('/materials/:id', { preHandler: [authenticate] }, materialController.remove);

  // ─── Sequences ───────────────────────────────────────────────────────
  app.get('/sequences', { preHandler: [authenticate] }, sequenceController.list);
  app.get<{ Params: { id: string } }>('/sequences/:id', { preHandler: [authenticate] }, sequenceController.getOne);
  app.post('/sequences', { preHandler: [authenticate] }, sequenceController.create);
  app.put<{ Params: { id: string } }>('/sequences/:id', { preHandler: [authenticate] }, sequenceController.update);
  app.delete<{ Params: { id: string } }>('/sequences/:id', { preHandler: [authenticate] }, sequenceController.remove);
  app.get<{ Params: { id: string } }>('/sequences/:id/enrollments', { preHandler: [authenticate] }, sequenceController.enrollments);
  app.post<{ Params: { id: string } }>('/sequences/:id/enroll', { preHandler: [authenticate] }, sequenceController.enroll);
  app.post<{ Params: { id: string } }>('/sequences/:id/enroll-all', { preHandler: [authenticate] }, sequenceController.enrollAll);
  app.post<{ Params: { enrollmentId: string } }>('/enrollments/:enrollmentId/unenroll', { preHandler: [authenticate] }, sequenceController.unenroll);
  app.post<{ Params: { enrollmentId: string } }>('/enrollments/:enrollmentId/replied', { preHandler: [authenticate] }, sequenceController.replied);
}
