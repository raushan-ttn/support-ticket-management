import type { ConnectionOptions } from 'bullmq';
import config from './index';

const connection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
};

export default connection;
