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

let _backend: StorageBackend | null = null;

export async function getStorageBackend(): Promise<StorageBackend> {
  if (_backend) return _backend;
  if (config.storage.backend === 's3') {
    const { S3StorageBackend } = await import('./s3');
    _backend = new S3StorageBackend();
  } else {
    const { LocalStorageBackend } = await import('./local');
    _backend = new LocalStorageBackend();
  }
  return _backend;
}
