import { z } from 'zod';

export const uuidParam = z.string().uuid({ message: 'Invalid UUID' });
