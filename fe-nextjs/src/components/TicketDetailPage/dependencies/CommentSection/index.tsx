'use client';

interface Props {
  ticketId: number;
}

export default function CommentSection({ ticketId: _ticketId }: Props) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="font-semibold text-zinc-800">Comments</h3>
      <p className="mt-2 text-sm text-zinc-400">No comments yet.</p>
    </div>
  );
}
