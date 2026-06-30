import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api';

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: BASE_URL,
    prepareHeaders: (headers, { extra }) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      // Do NOT set Content-Type here — let fetch handle it automatically
      // so FormData payloads get the correct multipart boundary.
      return headers;
    },
  }),
  tagTypes: ['Ticket', 'Comment'],
  endpoints: () => ({}),
});
