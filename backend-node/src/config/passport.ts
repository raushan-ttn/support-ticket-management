import bcrypt from 'bcrypt';
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { Strategy as LocalStrategy } from 'passport-local';
import { UserRole } from '../modules/auth/auth.schemas';
import config from './index';
import { query } from './postgres';

interface LocalUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'ADMIN' | 'AGENT';
  status: 'ACTIVE' | 'BLOCKED';
}

interface SafeUserRow {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'AGENT';
  status: 'ACTIVE' | 'BLOCKED';
}

const ROLE_MAP: Record<string, UserRole> = {
  ADMIN: 'ADMIN',
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
      if (user.status === 'BLOCKED') {
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
      if (user.status === 'BLOCKED') return done(null, false);
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
