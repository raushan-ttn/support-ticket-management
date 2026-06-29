import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import config from '../config';
import { StorageBackend } from './index';

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const { region, accessKeyId, secretAccessKey, endpoint } = config.storage.s3;
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.bucket = config.storage.s3.bucket;
  }

  async save(key: string, stream: Readable, mimeType: string, sizeBytes: number): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      },
    });
    await upload.done();
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) {
      throw Object.assign(new Error('Object not found'), { statusCode: 404 });
    }
    if (!(body instanceof Readable)) {
      throw Object.assign(new Error('Unexpected response body type from S3'), { statusCode: 500 });
    }
    return body;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
