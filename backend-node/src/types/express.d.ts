export {};

declare global {
  namespace Express {
    interface User {
      id: string;
      name: string;
      email: string;
      role: 'admin' | 'agent' | 'user';
      status: 'active' | 'blocked';
    }
  }
}
