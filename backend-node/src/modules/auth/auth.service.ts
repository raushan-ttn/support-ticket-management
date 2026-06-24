import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { query } from '../../config/postgres';
import config from '../../config';
import { RegisterPayload } from './auth.schemas';

const SALT_ROUNDS = 12;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent' | 'user';
  status: 'active' | 'blocked';
}

export const register = async (payload: RegisterPayload): Promise<UserRow> => {
  const { name, email, password } = payload;

  const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw Object.assign(new Error('Email already in use'), { statusCode: 409 });
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await query<UserRow>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role, status`,
    [name, email, password_hash],
  );
  return result.rows[0];
};

export const signToken = async (
  user: Express.User,
): Promise<{ token: string; user: Express.User }> => {
  await query('UPDATE users SET last_logged_in = NOW() WHERE id = $1', [user.id]);
  const options = { expiresIn: config.jwt.expiresIn } as SignOptions;
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, options);
  return { token, user };
};
