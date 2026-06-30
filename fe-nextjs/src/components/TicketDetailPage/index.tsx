'use client';

import CommentSection from './dependencies/CommentSection';
import TicketInfo from './dependencies/TicketInfo';

interface Props {
  ticketId: number;
}

export default function TicketDetailPage({ ticketId }: Props) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <TicketInfo ticketId={ticketId} />
      <CommentSection ticketId={ticketId} />
    </main>
  );
}
