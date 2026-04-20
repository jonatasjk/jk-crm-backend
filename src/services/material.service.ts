import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { env } from '../config/env.js';
import { Material } from '../models/Material.js';
import type { EntityType } from '../types/enums.js';
import { randomUUID } from 'crypto';

const uploadsRoot = join(process.cwd(), env.UPLOADS_DIR);

export async function uploadMaterial(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  entityType: EntityType,
  description?: string,
) {
  const ext = originalName.split('.').pop() ?? 'bin';
  const subDir = join(uploadsRoot, 'materials', entityType.toLowerCase());
  await mkdir(subDir, { recursive: true });
  const fileKey = `materials/${entityType.toLowerCase()}/${randomUUID()}.${ext}`;
  await writeFile(join(uploadsRoot, fileKey), buffer);
  return Material.create({ name: originalName, description, fileKey, mimeType, sizeBytes, entityType });
}

export async function getMaterialBuffer(fileKey: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const material = await Material.findOne({ fileKey });
  if (!material) throw new Error('Not found');
  const buffer = await readFile(join(uploadsRoot, fileKey));
  return { buffer, mimeType: material.mimeType, name: material.name };
}

export async function getMaterialForDownload(materialId: string) {
  const material = await Material.findById(materialId);
  if (!material) throw new Error('Not found');
  const buffer = await readFile(join(uploadsRoot, material.fileKey));
  return { material, buffer };
}

export async function deleteMaterial(materialId: string) {
  const material = await Material.findById(materialId);
  if (!material) throw new Error('Not found');
  try {
    await unlink(join(uploadsRoot, material.fileKey));
  } catch {
    // file may already be absent from disk
  }
  return Material.findByIdAndDelete(materialId);
}

export async function listMaterials(entityType?: EntityType) {
  const docs = await Material.find(entityType ? { entityType } : {}).sort({ createdAt: -1 }).lean();
  return docs.map((d) => ({ ...d, id: String(d._id), _id: undefined, __v: undefined }));
}
