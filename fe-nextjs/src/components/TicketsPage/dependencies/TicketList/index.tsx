'use client';

import { useDeleteTicketMutation, useGetTicketsQuery, type TicketsQuery } from '@/services/ticketApi';

interface Props {
  filters: TicketsQuery;
}

export default function TicketList({ filters }: Props) {
  const { data, isLoading, isError } = useGetTicketsQuery(filters);
  const [deleteTicket] = useDeleteTicketMutation();

  if (isLoading) return <p className="text-sm text-zinc-500">Loading tickets…</p>;
  if (isError) return <p className="text-sm text-red-500">Failed to load tickets.</p>;

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
      {data?.data.map((ticket) => (
        <li key={ticket.id} className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="font-medium text-zinc-900">{ticket.title}</p>
            <p className="text-xs text-zinc-500">
              {ticket.status} · {ticket.priority}
            </p>
          </div>
          <button
            onClick={() => deleteTicket(ticket.id)}
            className="text-xs text-red-500 hover:underline"
          >
            Delete
          </button>
        </li>
      ))}
      {data?.data.length === 0 && (
        <li className="px-4 py-6 text-center text-sm text-zinc-400">No tickets found.</li>
      )}
    </ul>
  );
}
