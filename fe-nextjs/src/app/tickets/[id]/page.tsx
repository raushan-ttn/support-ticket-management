import TicketDetailPage from '@/components/TicketDetailPage';

export const metadata = { title: 'Ticket Detail' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <TicketDetailPage ticketId={Number(id)} />;
}
