import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  uploadMaterial,
  getMaterialBuffer,
  getMaterialForDownload,
  deleteMaterial,
  listMaterials,
} from '../../src/services/material.service.js';
import { Material } from '../../src/models/Material.js';
import { EntityType } from '../../src/types/enums.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'uploads-test');

describe('Material service', () => {
  beforeAll(async () => {
    await connectTestDB();
    await mkdir(TEST_UPLOADS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await disconnectTestDB();
    await rm(TEST_UPLOADS_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // ─── uploadMaterial ────────────────────────────────────────────────────────

  describe('uploadMaterial', () => {
    it('writes file to disk and creates Material document', async () => {
      const buf = Buffer.from('PDF content');
      const material = await uploadMaterial(buf, 'test.pdf', 'application/pdf', buf.length, EntityType.INVESTOR);
      expect(material.name).toBe('test.pdf');
      expect(material.mimeType).toBe('application/pdf');
      expect(material.entityType).toBe(EntityType.INVESTOR);

      const doc = await Material.findById(material._id);
      expect(doc).not.toBeNull();
    });

    it('stores description when provided', async () => {
      const buf = Buffer.from('file');
      const material = await uploadMaterial(buf, 'readme.txt', 'text/plain', buf.length, EntityType.PARTNER, 'A readme');
      expect(material.description).toBe('A readme');
    });
  });

  // ─── getMaterialBuffer ─────────────────────────────────────────────────────

  describe('getMaterialBuffer', () => {
    it('reads the buffer back from disk', async () => {
      const buf = Buffer.from('Hello material');
      const material = await uploadMaterial(buf, 'hello.txt', 'text/plain', buf.length, EntityType.INVESTOR);
      const result = await getMaterialBuffer(material.fileKey);
      expect(result.buffer.toString()).toBe('Hello material');
      expect(result.mimeType).toBe('text/plain');
    });

    it('throws when fileKey not found in DB', async () => {
      await expect(getMaterialBuffer('materials/investor/nonexistent.pdf')).rejects.toThrow('Not found');
    });
  });

  // ─── getMaterialForDownload ────────────────────────────────────────────────

  describe('getMaterialForDownload', () => {
    it('returns material doc and buffer', async () => {
      const buf = Buffer.from('Download me');
      const material = await uploadMaterial(buf, 'dl.txt', 'text/plain', buf.length, EntityType.INVESTOR);
      const result = await getMaterialForDownload(String(material._id));
      expect(result.material.name).toBe('dl.txt');
      expect(result.buffer.toString()).toBe('Download me');
    });

    it('throws when material not found', async () => {
      await expect(getMaterialForDownload('000000000000000000000000')).rejects.toThrow('Not found');
    });
  });

  // ─── listMaterials ─────────────────────────────────────────────────────────

  describe('listMaterials', () => {
    it('lists all materials when no entityType filter', async () => {
      const buf = Buffer.from('x');
      await uploadMaterial(buf, 'inv.pdf', 'application/pdf', buf.length, EntityType.INVESTOR);
      await uploadMaterial(buf, 'par.pdf', 'application/pdf', buf.length, EntityType.PARTNER);
      const result = await listMaterials();
      expect(result).toHaveLength(2);
    });

    it('filters by entityType', async () => {
      const buf = Buffer.from('x');
      await uploadMaterial(buf, 'inv.pdf', 'application/pdf', buf.length, EntityType.INVESTOR);
      await uploadMaterial(buf, 'par.pdf', 'application/pdf', buf.length, EntityType.PARTNER);
      const result = await listMaterials(EntityType.INVESTOR);
      expect(result).toHaveLength(1);
      expect(result[0]!['entityType']).toBe('INVESTOR');
    });
  });

  // ─── deleteMaterial ────────────────────────────────────────────────────────

  describe('deleteMaterial', () => {
    it('removes doc from DB', async () => {
      const buf = Buffer.from('delete me');
      const material = await uploadMaterial(buf, 'del.txt', 'text/plain', buf.length, EntityType.INVESTOR);
      await deleteMaterial(String(material._id));
      const doc = await Material.findById(material._id);
      expect(doc).toBeNull();
    });

    it('throws when material not found', async () => {
      await expect(deleteMaterial('000000000000000000000000')).rejects.toThrow('Not found');
    });

    it('succeeds even if file is already missing from disk', async () => {
      const buf = Buffer.from('gone');
      const material = await uploadMaterial(buf, 'gone.txt', 'text/plain', buf.length, EntityType.INVESTOR);
      // Manually unlink the file to simulate missing file
      const { unlink } = await import('fs/promises');
      try { await unlink(join(TEST_UPLOADS_DIR, material.fileKey)); } catch { /* ignore */ }
      await expect(deleteMaterial(String(material._id))).resolves.toBeDefined();
    });
  });
});
