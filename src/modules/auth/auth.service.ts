import jwt, { SignOptions } from 'jsonwebtoken';

import config from '../../config';
import { query } from '../../config/postgres';
import { AuthUser } from './auth.schemas';

export const signToken = async (user: AuthUser): Promise<{ token: string; user: AuthUser }> => {
  await query('UPDATE users SET last_logged_in = NOW() WHERE id = $1', [user.id]);
  const options = { expiresIn: config.jwt.expiresIn } as SignOptions;
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, options);
  return { token, user };
};
