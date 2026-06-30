# Skill: Feature Implementation

## Purpose
Implement a planned, approved feature correctly and consistently with the project architecture.

## Prerequisites
A plan has been reviewed and approved (see `../planning/SKILL.md`). Rendering strategy is decided.

---

## Step-by-Step Checklist

### 1. Types (`src/types/[feature].ts`)

```typescript
// ✅ Interface for every shape, no any
export interface Comment {
  id: number;
  ticketId: number;
  content: string;
  createdAt: string;
}

export interface CreateCommentPayload {
  ticketId: number;
  content: string;
}
```

- `interface` for object shapes, no `any`, export all names
- Re-use existing types from `src/services/ticketApi.ts` where possible

### 2. RTK Query Service (if client mutations needed)

```typescript
// src/services/commentApi.ts
import { baseApi } from './baseApi';

export const commentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getComments: builder.query<Comment[], number>({
      query: (ticketId) => `/tickets/${ticketId}/comments`,
      providesTags: (_r, _e, id) => [{ type: 'Comment', id }],
    }),
    createComment: builder.mutation<Comment, CreateCommentPayload>({
      query: ({ ticketId, content }) => ({
        url: `/tickets/${ticketId}/comments`,
        method: 'POST',
        body: { content },
      }),
      invalidatesTags: (_r, _e, { ticketId }) => [{ type: 'Comment', id: ticketId }],
    }),
  }),
});

export const { useGetCommentsQuery, useCreateCommentMutation } = commentApi;
```

Key rules:
- Always `injectEndpoints` on `baseApi` — never `createApi()`
- `providesTags` and `invalidatesTags` on every endpoint
- No store wiring needed for `injectEndpoints`

### 3. Server Action (if server-validated mutation needed)

```typescript
// src/actions/[feature]-actions.ts
'use server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';

const schema = z.object({ /* ... */ });

export async function doSomethingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ field: fd.get('field') });
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  const res = await fetch(/* ... */, { method: 'POST', body: JSON.stringify(parsed.data) });
  if (!res.ok) return { success: false, error: 'Failed' };

  revalidateTag('tag');
  return { success: true };
}
```

### 4. Server Component (async data fetching)

```typescript
// src/components/[Feature]/Server[Name].tsx  — NO 'use client'
export async function Server[Name]({ id }: { id: number }) {
  const res = await fetch(`${BASE}/resource/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load');
  const data = await res.json();
  return <div>{/* render data */}</div>;
}
```

- `async function` — no hooks, no events, no browser APIs
- Throw on failure — caught by `error.tsx`
- Props must be serializable

### 5. Client Component (interactivity + RTK Query)

```typescript
// src/components/[Feature]/[Name]/index.tsx
'use client';  // line 1

import { useState } from 'react';
import { Button, TextField } from '@mui/material';
import { useCreateCommentMutation } from '@/services/commentApi';
import styles from './[name].module.scss';

export function [Name]({ ticketId }: { ticketId: number }) {
  const [createComment, { isLoading }] = useCreateCommentMutation();
  ...
}
```

- `'use client'` on line 1 — before all imports
- Named export
- SCSS module co-located — no `@use 'abstracts'` (auto-injected)
- MUI inputs via `Controller` if inside a form

### 6. Page (`src/app/[route]/page.tsx`)

```typescript
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServerComponent } from '@/components/Feature/ServerComponent';
import { ClientComponent } from '@/components/Feature/ClientComponent';
import { FeatureSkeleton } from '@/components/Feature/FeatureSkeleton';

export const metadata: Metadata = {
  title: 'Page Title | Support Portal',
  description: 'Page description under 155 chars.',
};

export default function FeaturePage() {
  return (
    <main>
      <Suspense fallback={<FeatureSkeleton />}>
        <ServerComponent />
      </Suspense>
      <ClientComponent />
    </main>
  );
}
```

- Default export (Next.js requirement for pages)
- `metadata` export on every page
- Wrap slow async RSC in `<Suspense>`

### 7. Loading + Error UI

```typescript
// src/app/[route]/loading.tsx
export default function Loading() { return <FeatureSkeleton />; }

// src/app/[route]/error.tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <div><p>Error: {error.message}</p><button onClick={reset}>Retry</button></div>;
}
```

---

## Quality Gates (Before Marking Done)
- [ ] No `any` types
- [ ] No `console.log`
- [ ] No dead code or unused imports
- [ ] No `@use 'abstracts'` in `.module.scss` files
- [ ] All MUI inputs use `Controller` inside forms
- [ ] Error outputs have `role="alert"`
- [ ] Submit buttons reflect `isLoading` state
- [ ] `'use client'` on line 1 in every Client Component
- [ ] `metadata` exported from every page
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Feature works in browser (`npm run dev`)
