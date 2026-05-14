/**
 * One-off script: remove duplicate Enrollment records.
 *
 * For every (sequenceId, entityId) pair that has more than one enrollment,
 * keeps the "best" one and deletes the rest.
 *
 * Priority order (kept first):
 *   ACTIVE > REPLIED > COMPLETED > UNSUBSCRIBED
 *   Within the same status: most recently created wins.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-enrollments.mjs
 *   node scripts/cleanup-duplicate-enrollments.mjs --dry-run   # preview only, no deletes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const STATUS_RANK = { ACTIVE: 0, REPLIED: 1, COMPLETED: 2, UNSUBSCRIBED: 3 };

await mongoose.connect(MONGODB_URI);
console.log(`Connected to MongoDB. DRY_RUN=${DRY_RUN}\n`);

const db = mongoose.connection.db;
const col = db.collection('enrollments');

// 1. Find all (sequenceId, entityId) groups with more than one document.
const duplicateGroups = await col.aggregate([
  {
    $group: {
      _id: { sequenceId: '$sequenceId', entityId: '$entityId' },
      ids: { $push: '$_id' },
      count: { $sum: 1 },
    },
  },
  { $match: { count: { $gt: 1 } } },
]).toArray();

if (duplicateGroups.length === 0) {
  console.log('No duplicate enrollments found. Nothing to do.');
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`Found ${duplicateGroups.length} duplicate group(s).\n`);

let totalDeleted = 0;

for (const group of duplicateGroups) {
  const { sequenceId, entityId } = group._id;

  const docs = await col
    .find({ sequenceId, entityId })
    .sort({ createdAt: -1 })
    .toArray();

  // Sort: best status first, then newest first within same status.
  docs.sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 99;
    const rankB = STATUS_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const [keep, ...remove] = docs;
  const removeIds = remove.map((d) => d._id);

  console.log(
    `sequenceId=${sequenceId} entityId=${entityId}\n` +
    `  KEEP  _id=${keep._id} status=${keep.status} createdAt=${keep.createdAt}\n` +
    remove.map((d) => `  DELETE _id=${d._id} status=${d.status} createdAt=${d.createdAt}`).join('\n'),
  );

  if (!DRY_RUN) {
    const result = await col.deleteMany({ _id: { $in: removeIds } });
    totalDeleted += result.deletedCount;
    console.log(`  → deleted ${result.deletedCount} record(s)\n`);
  } else {
    console.log(`  → (dry-run) would delete ${removeIds.length} record(s)\n`);
  }
}

console.log(DRY_RUN
  ? `Dry-run complete. Would have deleted ${duplicateGroups.reduce((acc, g) => acc + g.count - 1, 0)} record(s).`
  : `Done. Total deleted: ${totalDeleted}.`);

await mongoose.disconnect();
