interface TicketPayload {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
}

interface TicketFilters {
  status?: string;
  priority?: string;
  assignee?: string;
}

export const findAll = async (_filters: TicketFilters = {}) => {
  // TODO: query DB with filters (status, priority, assignee)
  return [];
};

export const findById = async (id: string) => {
  // TODO: query DB by id
  return { id, title: 'Sample ticket', status: 'open', priority: 'medium' };
};

export const create = async (payload: TicketPayload) => {
  // TODO: insert record into DB
  return { id: Date.now(), ...payload, status: 'open' };
};

export const update = async (id: string, payload: TicketPayload) => {
  // TODO: update record in DB
  return { id, ...payload };
};

export const remove = async (id: string) => {
  // TODO: delete record from DB
  return { id };
};
