import dotenv from 'dotenv';
dotenv.config();

interface Config {
  env: string;
  port: number;
  cors: {
    origin: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolMin: number;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    ssl: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string | undefined;
    db: number;
    keyPrefix: string;
    ttlSeconds: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  storage: {
    backend: 'local' | 's3';
    localDir: string;
    s3: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint: string | undefined;
    };
  };
  attachment: {
    allowedMimeTypes: string[];
    maxFileSizeBytes: number;
    maxFilesPerRequest: number;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX || '20', 10),
  },

  postgres: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'ttn_stm',
    poolMin: parseInt(process.env.PG_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMs: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMs: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || '5000', 10),
    ssl: process.env.PG_SSL === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'stm:',
    ttlSeconds: parseInt(process.env.REDIS_TTL_SECONDS || '3600', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'changeme',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  storage: {
    backend: (process.env.STORAGE_BACKEND as 'local' | 's3') || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || 'public',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      endpoint: process.env.S3_ENDPOINT || undefined,
    },
  },

  attachment: {
    allowedMimeTypes: (
      process.env.ATTACHMENT_ALLOWED_MIME_TYPES ||
      'image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain'
    ).split(','),
    maxFileSizeBytes: parseInt(process.env.ATTACHMENT_MAX_FILE_SIZE_BYTES || '10485760', 10), // 10 MB
    maxFilesPerRequest: parseInt(process.env.ATTACHMENT_MAX_FILES_PER_REQUEST || '5', 10),
  },
};

export default config;
