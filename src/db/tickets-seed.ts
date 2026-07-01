import dotenv from 'dotenv';
dotenv.config();

import { query, disconnectPostgres } from '../config/postgres';

interface UserRow {
  id: string;
  name: string;
  role: string;
}

interface TicketRow {
  id: string;
  title: string;
}

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';

const TICKETS: Array<{
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  type: string;
  subType: string;
}> = [
  {
    title: 'Login page returns 500 error for SSO users',
    description:
      'Users attempting to sign in via SSO are intermittently hitting a 500 Internal Server Error. The issue started after the auth library was upgraded last Tuesday. Browser console shows no helpful message; server logs show a JWT parsing exception.',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    type: 'BUG',
    subType: 'AUTHENTICATION',
  },
  {
    title: 'Password reset email not delivered',
    description:
      'Multiple users reported that clicking "Forgot Password" triggers no email. SMTP logs confirm the message is leaving our server, but recipients never receive it. Suspected spam-filter issue on the destination side, but needs investigation.',
    priority: 'URGENT',
    status: 'OPEN',
    type: 'BUG',
    subType: 'EMAIL',
  },
  {
    title: 'Dashboard charts blank on mobile Safari',
    description:
      'The analytics charts on the main dashboard fail to render on iOS Safari 17+. A white box appears instead of the chart. The same page works fine on Chrome for Android. Likely a WebGL or canvas sizing issue.',
    priority: 'MEDIUM',
    status: 'OPEN',
    type: 'BUG',
    subType: 'UI',
  },
  {
    title: 'CSV export downloads corrupted file',
    description:
      'Exporting a filtered report to CSV produces a file with garbled UTF-8 characters and misaligned columns when opened in Excel. The raw bytes look correct in a hex editor, so the issue is likely the BOM header or line-ending format.',
    priority: 'HIGH',
    status: 'RESOLVED',
    type: 'BUG',
    subType: 'DATA_EXPORT',
  },
  {
    title: 'Profile image upload silently fails for PNG over 2 MB',
    description:
      'When a user uploads a PNG avatar larger than roughly 2 MB the UI shows a success toast but the image never updates. No error is logged on the server. Smaller PNGs and all JPEGs work as expected.',
    priority: 'LOW',
    status: 'CLOSED',
    type: 'BUG',
    subType: 'FILE_UPLOAD',
  },
  {
    title: 'Search results show duplicate ticket entries',
    description:
      'Full-text search on the tickets list occasionally returns the same ticket two or three times in a single page of results. This appears related to the new relevance-ranking JOIN added in the last sprint.',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    type: 'BUG',
    subType: 'SEARCH',
  },
  {
    title: 'TOTP codes expire before user can enter them',
    description:
      'Agents using two-factor authentication via authenticator apps are being rejected even when they enter the code immediately. The server clock appears to be drifting; NTP sync should be verified.',
    priority: 'HIGH',
    status: 'OPEN',
    type: 'BUG',
    subType: 'SECURITY',
  },
  {
    title: 'Sidebar background color incorrect in dark mode',
    description:
      'The left navigation sidebar renders with a light-grey background instead of the expected dark surface colour when the OS or app is set to dark mode. Traced to a missing CSS variable override in the dark-mode stylesheet.',
    priority: 'LOW',
    status: 'OPEN',
    type: 'BUG',
    subType: 'UI',
  },
  {
    title: 'Notification badge count does not clear after reading',
    description:
      'The red notification badge on the bell icon continues showing the unread count even after the user opens and reads all notifications. The mark-as-read API call is firing (confirmed in network tab) but the UI state is not updating.',
    priority: 'MEDIUM',
    status: 'RESOLVED',
    type: 'BUG',
    subType: 'UI',
  },
  {
    title: 'Bulk API endpoints hit rate limit too aggressively',
    description:
      'The batch-update endpoint for tickets is rate-limited at 60 req/min which matches the per-user limit applied to all routes. Bulk operations need a separate, higher limit or should be excluded from the standard limiter.',
    priority: 'HIGH',
    status: 'CANCELLED',
    type: 'FEATURE_REQUEST',
    subType: 'API',
  },
];

const COMMENT_POOL: string[] = [
  'Reproduced the issue locally. Will begin root-cause analysis.',
  'Confirmed — the bug exists in the staging environment as well.',
  'Looking into the server logs now. Should have an update shortly.',
  'Found the problematic commit. Rolling back to narrow down the cause.',
  'Fix deployed to staging. Please verify when you get a chance.',
  'Can you share the exact steps to reproduce? I cannot replicate it on my machine.',
  'This is blocking several users. Escalating priority.',
  'Spoke to the infrastructure team — no recent config changes on their side.',
  'The fix is straightforward. PR raised and ready for review.',
  'Closing this as the reporter confirmed it is no longer occurring after the update.',
  'Added to the next sprint for a permanent fix; temporary workaround documented in the wiki.',
  'Root cause identified: a missing null check introduced in the v2.4 release.',
  'Patch merged and deployed to production. Monitoring for recurrence.',
  'Assigned to myself. Will work on this today.',
  'Needs more information before we can proceed. Waiting on logs from the reporter.',
  'Tested in QA — the fix resolves the issue without regression.',
  'Related to ticket #1042. Fixing both together to avoid duplicate effort.',
  'No activity from the reporter in 7 days. Sending a follow-up before closing.',
  'Issue verified on Firefox 124 as well; not browser-specific after all.',
  'Marking resolved. Reopen if the issue resurfaces.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickUnique<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

async function seedTickets(): Promise<void> {
  const usersResult = await query<UserRow>(
    `SELECT id, name, role FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`,
    [],
  );

  if (!usersResult.rowCount || usersResult.rowCount === 0) {
    console.error('[Seed] No users found — run db:seed first to create admin and agents.');
    process.exit(1);
  }

  const users = usersResult.rows;
  const admin = users.find((u) => u.role === 'ADMIN');
  const agents = users.filter((u) => u.role === 'AGENT');

  if (!admin) {
    console.error('[Seed] No ADMIN user found — run db:seed first.');
    process.exit(1);
  }

  if (agents.length === 0) {
    console.error('[Seed] No AGENT users found — run db:seed first.');
    process.exit(1);
  }

  console.log(`[Seed] Found ${users.length} users (1 admin, ${agents.length} agents)`);

  const createdTickets: TicketRow[] = [];

  for (const ticket of TICKETS) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM tickets WHERE title = $1 LIMIT 1`,
      [ticket.title],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log(`[Seed] Ticket already exists — skipping: "${ticket.title}"`);
      createdTickets.push({ id: existing.rows[0].id, title: ticket.title });
      continue;
    }

    const createdBy = pick([admin, ...agents]);
    const assignedTo = pick(agents);

    const result = await query<TicketRow>(
      `INSERT INTO tickets (title, description, type, sub_type, priority, status, created_by, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title`,
      [ticket.title, ticket.description, ticket.type, ticket.subType, ticket.priority, ticket.status, createdBy.id, assignedTo.id],
    );

    const created = result.rows[0];
    createdTickets.push(created);
    console.log(
      `[Seed] Ticket created [${ticket.type}/${ticket.subType}][${ticket.priority}/${ticket.status}] — "${created.title}"`,
    );
  }

  console.log(`\n[Seed] Seeding comments for ${createdTickets.length} tickets...`);

  for (const ticket of createdTickets) {
    const existingComments = await query<{ id: string }>(
      `SELECT id FROM comments WHERE ticket_id = $1 LIMIT 1`,
      [ticket.id],
    );
    if (existingComments.rowCount && existingComments.rowCount > 0) {
      console.log(`[Seed] Comments already exist for "${ticket.title}" — skipping`);
      continue;
    }

    const commentCount = 2 + Math.floor(Math.random() * 2); // 2 or 3 comments
    const commentors = pickUnique([admin, ...agents], commentCount);
    const usedMessages = new Set<string>();

    for (const commentor of commentors) {
      let message = pick(COMMENT_POOL);
      // avoid duplicate messages on the same ticket
      while (usedMessages.has(message)) {
        message = pick(COMMENT_POOL);
      }
      usedMessages.add(message);

      await query(
        `INSERT INTO comments (ticket_id, message, created_by) VALUES ($1, $2, $3)`,
        [ticket.id, message, commentor.id],
      );
    }

    console.log(`[Seed] ${commentors.length} comments added — "${ticket.title}"`);
  }
}

seedTickets()
  .then(() => console.log('\n[Seed] Tickets and comments seeded successfully.'))
  .catch((err: Error) => {
    console.error('[Seed] Failed:', err.message);
    process.exit(1);
  })
  .finally(() => disconnectPostgres());
