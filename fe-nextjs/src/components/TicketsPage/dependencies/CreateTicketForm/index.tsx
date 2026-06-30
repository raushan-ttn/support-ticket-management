'use client';

import { useRef, useState } from 'react';
import { useCreateTicketMutation, type TicketPriority } from '@/services/ticketApi';

export default function CreateTicketForm() {
  const [create, { isLoading }] = useCreateTicketMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [priority, setPriority] = useState<TicketPriority>('medium');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value.trim();
    const description = (form.elements.namedItem('description') as HTMLTextAreaElement).value.trim();
    const files = Array.from(fileRef.current?.files ?? []);

    await create({ title, description, priority, attachments: files });
    form.reset();
    setPriority('medium');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-semibold text-zinc-800">New Ticket</h2>

      <input
        name="title"
        required
        placeholder="Title"
        className="rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
      />

      <textarea
        name="description"
        required
        rows={3}
        placeholder="Description"
        className="rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
      />

      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as TicketPriority)}
        className="rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
      >
        {(['low', 'medium', 'high', 'critical'] as TicketPriority[]).map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <input ref={fileRef} type="file" multiple className="text-sm text-zinc-500" />

      <button
        type="submit"
        disabled={isLoading}
        className="self-end rounded bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isLoading ? 'Creating…' : 'Create Ticket'}
      </button>
    </form>
  );
}
