import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcrypt';
import { query, disconnectPostgres } from '../config/postgres';

interface UserRow {
  id: string;
}

const SALT_ROUNDS = 12;

const admin = {
  name: process.env.ADMIN_NAME || 'Super Admin',
  email: process.env.ADMIN_EMAIL || 'admin@ttn.com',
  password: process.env.ADMIN_PASSWORD || 'Admin@123',
};

async function seed(): Promise<void> {
  console.log(`[Seed] Checking for admin <${admin.email}>...`);

  const existing = await query<UserRow>('SELECT id FROM users WHERE email = $1', [admin.email]);

  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`[Seed] Admin already exists (id: ${existing.rows[0].id}) — skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(admin.password, SALT_ROUNDS);

  const result = await query<UserRow>(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, 'admin', 'active')
     RETURNING id`,
    [admin.name, admin.email, passwordHash],
  );

  console.log(`[Seed] Admin created — id: ${result.rows[0].id}, email: ${admin.email}`);
}

seed()
  .catch((err: Error) => {
    console.error('[Seed] Failed:', err.message);
    process.exit(1);
  })
  .finally(() => disconnectPostgres());
