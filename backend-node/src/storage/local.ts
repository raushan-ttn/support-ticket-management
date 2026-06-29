import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import config from '../config';
import { StorageBackend } from './index';

export class LocalStorageBackend implements StorageBackend {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(config.storage.localDir);
  }

  private safePath(key: string): string {
    const resolved = path.resolve(this.baseDir, key);
    const base = this.baseDir.endsWith(path.sep) ? this.baseDir : this.baseDir + path.sep;
    if (!resolved.startsWith(base)) {
      throw Object.assign(new Error('Invalid storage key'), { statusCode: 400 });
    }
    return resolved;
  }

  async save(key: string, stream: Readable, _mimeType: string, _sizeBytes: number): Promise<void> {
    const filePath = this.safePath(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const writeStream = fs.createWriteStream(filePath);
    await pipeline(stream, writeStream);
  }

  async getStream(key: string): Promise<Readable> {
    const filePath = this.safePath(key);
    await fs.promises.access(filePath, fs.constants.R_OK);
    return fs.createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.safePath(key);
    await fs.promises.rm(filePath, { force: true });
  }
}
