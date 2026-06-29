import { z } from 'zod';

export type UserRole = 'ADMIN' | 'AGENT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'blocked';
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginPayload = z.infer<typeof loginSchema>;
