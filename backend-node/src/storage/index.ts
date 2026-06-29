import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import config from '../config';

export interface StorageBackend {
  save(key: string, stream: Readable, mimeType: string, sizeBytes: number): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export function buildStorageKey(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${date}/${randomUUID()}`;
}

export async function getStorageBackend(): Promise<StorageBackend> {
  if (config.storage.backend === 's3') {
    const { S3StorageBackend } = await import('./s3');
    return new S3StorageBackend();
  }
  const { LocalStorageBackend } = await import('./local');
  return new LocalStorageBackend();
}
