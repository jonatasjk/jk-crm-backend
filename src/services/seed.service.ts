import bcrypt from 'bcrypt';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { Role } from '../types/enums.js';

export async function seedAdminUser() {
  const count = await User.countDocuments();
  if (count > 0) return;

  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.warn(
      '⚠️  No users exist and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set. ' +
        'Set these env vars to bootstrap the first admin user.',
    );
    return;
  }

  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);
  await User.create({
    email: env.SEED_ADMIN_EMAIL,
    name: 'Admin',
    passwordHash,
    role: Role.ADMIN,
    mustChangePassword: true,
  });

  console.info(`✅ Seed admin created: ${env.SEED_ADMIN_EMAIL} (must change password on first login)`);
}
