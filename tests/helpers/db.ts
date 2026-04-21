import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from '../../src/models/User.js';
import { Role } from '../../src/types/enums.js';

let mongod: MongoMemoryServer | null = null;

export async function connectTestDB() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

export async function disconnectTestDB() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod?.stop();
  mongod = null;
}

export async function clearTestDB() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key]!.deleteMany({});
  }
}

/** Create an admin user directly in DB (bypasses invite flow for test auth setup) */
export async function createAdminUser(email = 'admin@test.com', password = 'password123', name = 'Admin') {
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, name, passwordHash, role: Role.ADMIN, mustChangePassword: false });
  return { email, password };
}
