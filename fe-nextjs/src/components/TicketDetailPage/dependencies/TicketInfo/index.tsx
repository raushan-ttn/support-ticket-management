'use client';

import { useGetTicketByIdQuery, useUpdateTicketMutation, type TicketStatus } from '@/services/ticketApi';

interface Props {
  ticketId: number;
}

export default function TicketInfo({ ticketId }: Props) {
  const { data: ticket, isLoading } = useGetTicketByIdQuery(ticketId);
  const [updateTicket] = useUpdateTicketMutation();

  if (isLoading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (!ticket) return null;

  function handleStatusChange(status: TicketStatus) {
    updateTicket({ id: ticketId, status });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-xl font-semibold text-zinc-900">{ticket.title}</h2>
      <p className="mt-2 text-sm text-zinc-600">{ticket.description}</p>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs font-medium text-zinc-500">Status:</span>
        <select
          value={ticket.status}
          onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs outline-none"
        >
          {(['open', 'in_progress', 'resolved', 'closed'] as TicketStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
