import { z } from 'zod';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  status: 'active' | 'blocked';
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginPayload = z.infer<typeof loginSchema>;
