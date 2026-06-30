import { z } from 'zod';

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().trim().min(1, 'Description is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

export const statusTransitionSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED']),
});

export const assignSchema = z.object({
  assignedTo: z.string().uuid({ message: 'assignedTo must be a valid UUID' }),
});

export const listTicketsQuerySchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'priority']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateTicketPayload = z.infer<typeof createTicketSchema>;
export type UpdateTicketPayload = z.infer<typeof updateTicketSchema>;
export type StatusTransitionPayload = z.infer<typeof statusTransitionSchema>;
export type AssignPayload = z.infer<typeof assignSchema>;
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export interface TicketRow {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketListResult {
  tickets: TicketRow[];
  total: number;
  page: number;
  limit: number;
}
