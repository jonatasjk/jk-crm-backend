import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
