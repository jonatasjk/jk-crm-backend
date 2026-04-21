import { buildApp } from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { startSequenceScheduler } from './services/sequence.scheduler.js';
import { seedAdminUser } from './services/seed.service.js';

async function start() {
  await connectDB();
  await seedAdminUser();
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`CRM Backend running on port ${env.PORT}`);
    startSequenceScheduler();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
