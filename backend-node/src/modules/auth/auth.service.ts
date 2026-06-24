interface RegisterPayload {
  email: string;
  password: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

export const register = async (payload: RegisterPayload) => {
  // TODO: hash password, save user to DB, return created user
  return { id: 1, email: payload.email, role: 'user' };
};

export const login = async (payload: LoginPayload) => {
  // TODO: validate credentials, sign and return JWT
  return { token: 'sample.jwt.token', email: payload.email };
};
