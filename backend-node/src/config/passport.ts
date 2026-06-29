import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptionsWithoutRequest } from 'passport-jwt';
import bcrypt from 'bcrypt';
import { query } from './postgres';
import config from './index';
import { UserRole } from '../modules/auth/auth.schemas';

// Raw DB row types reflect actual Postgres ENUM storage (lowercase, 3 values).
// Normalised to uppercase 2-value UserRole at the auth boundary via normaliseRole().
interface LocalUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'agent' | 'user';
  status: 'active' | 'blocked';
}

interface SafeUserRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent' | 'user';
  status: 'active' | 'blocked';
}

const ROLE_MAP: Record<string, UserRole> = {
  admin: 'ADMIN',
  ADMIN: 'ADMIN',
  agent: 'AGENT',
  AGENT: 'AGENT',
};

function normaliseRole(raw: string): UserRole {
  const mapped = ROLE_MAP[raw];
  if (!mapped)
    throw Object.assign(new Error(`Forbidden: unrecognised role '${raw}'`), { statusCode: 403 });
  return mapped;
}

interface JwtPayload {
  sub: string;
  role: 'ADMIN' | 'AGENT';
}

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const result = await query<LocalUserRow>(
        'SELECT id, name, email, password_hash, role, status FROM users WHERE email = $1',
        [email],
      );
      const user = result.rows[0];
      if (!user) {
        return done(null, false, { message: 'Invalid email or password' });
      }
      if (user.status === 'blocked') {
        return done(null, false, { message: 'Account is blocked' });
      }
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return done(null, false, { message: 'Invalid email or password' });
      }
      const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normaliseRole(user.role),
        status: user.status,
      };
      return done(null, safeUser);
    } catch (err) {
      return done(err as Error);
    }
  }),
);

const jwtOptions: StrategyOptionsWithoutRequest = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwt.secret,
};

passport.use(
  new JwtStrategy(jwtOptions, async (payload: JwtPayload, done) => {
    try {
      const result = await query<SafeUserRow>(
        'SELECT id, name, email, role, status FROM users WHERE id = $1',
        [payload.sub],
      );
      const user = result.rows[0];
      if (!user) return done(null, false);
      if (user.status === 'blocked') return done(null, false);
      return done(null, {
        ...user,
        role: normaliseRole(user.role),
      });
    } catch (err) {
      return done(err as Error);
    }
  }),
);

export default passport;
