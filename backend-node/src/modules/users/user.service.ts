interface UserPayload {
  name?: string;
  email?: string;
  role?: string;
}

export const findAll = async () => {
  // TODO: query DB
  return [];
};

export const findById = async (id: string) => {
  // TODO: query DB by id
  return { id, name: 'John Doe', email: 'john@example.com', role: 'user' };
};

export const update = async (id: string, payload: UserPayload) => {
  // TODO: update record in DB
  return { id, ...payload };
};

export const remove = async (id: string) => {
  // TODO: delete record from DB
  return { id };
};
