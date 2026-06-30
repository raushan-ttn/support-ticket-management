import { baseApi } from './baseApi';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  attachments: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketsResponse {
  data: Ticket[];
  total: number;
  page: number;
  limit: number;
}

export interface TicketsQuery {
  page?: number;
  limit?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  search?: string;
}

export interface CreateTicketPayload {
  title: string;
  description: string;
  priority: TicketPriority;
  attachments?: File[];
}

export interface UpdateTicketPayload {
  id: number;
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
}

export const ticketApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTickets: builder.query<TicketsResponse, TicketsQuery | void>({
      query: (params = {}) => ({ url: '/tickets', params: params ?? undefined }),
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({ type: 'Ticket' as const, id })),
              { type: 'Ticket', id: 'LIST' },
            ]
          : [{ type: 'Ticket', id: 'LIST' }],
    }),

    getTicketById: builder.query<Ticket, number>({
      query: (id) => `/tickets/${id}`,
      providesTags: (_result, _err, id) => [{ type: 'Ticket', id }],
    }),

    createTicket: builder.mutation<Ticket, CreateTicketPayload>({
      query: ({ attachments, ...rest }) => {
        // Use FormData when attachments are present
        if (attachments?.length) {
          const body = new FormData();
          Object.entries(rest).forEach(([k, v]) => body.append(k, String(v)));
          attachments.forEach((file) => body.append('attachments', file));
          return { url: '/tickets', method: 'POST', body };
        }
        return { url: '/tickets', method: 'POST', body: rest };
      },
      invalidatesTags: [{ type: 'Ticket', id: 'LIST' }],
    }),

    updateTicket: builder.mutation<Ticket, UpdateTicketPayload>({
      query: ({ id, ...patch }) => ({
        url: `/tickets/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_result, _err, { id }) => [
        { type: 'Ticket', id },
        { type: 'Ticket', id: 'LIST' },
      ],
    }),

    deleteTicket: builder.mutation<void, number>({
      query: (id) => ({ url: `/tickets/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _err, id) => [
        { type: 'Ticket', id },
        { type: 'Ticket', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetTicketsQuery,
  useGetTicketByIdQuery,
  useCreateTicketMutation,
  useUpdateTicketMutation,
  useDeleteTicketMutation,
} = ticketApi;
