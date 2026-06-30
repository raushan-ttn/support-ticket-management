import { configureStore } from '@reduxjs/toolkit';
import { ticketApi } from '@/services/ticketApi';

export const makeStore = () =>
  configureStore({
    reducer: {
      [ticketApi.reducerPath]: ticketApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(ticketApi.middleware),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
