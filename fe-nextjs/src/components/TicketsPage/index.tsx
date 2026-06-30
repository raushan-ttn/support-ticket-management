'use client';

import { useState } from 'react';
import { type TicketsQuery } from '@/services/ticketApi';
import CreateTicketForm from './dependencies/CreateTicketForm';
import TicketList from './dependencies/TicketList';

export default function TicketsPage() {
  const [filters, setFilters] = useState<TicketsQuery>({ page: 1, limit: 20 });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-900">Support Tickets</h1>
      <CreateTicketForm />
      <TicketList filters={filters} />
    </main>
  );
}
