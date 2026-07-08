import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';

import config from './config';
import passport from './config/passport';
import errorHandler from './middlewares/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import commentsRouter from './modules/comments/comment.routes';
import ticketRoutes from './modules/tickets/ticket.routes';
import { success } from './utils/response';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(compression());
app.use(morgan('dev'));
// Serve locally stored files (screenshots, attachments) for dev/test environments.
// S3 URLs are direct S3 object URLs so this middleware is a no-op in production.
app.use(express.static(config.storage.localDir));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(passport.initialize());

app.get('/health', (_req, res) =>
  success(res, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }),
);

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/tickets', commentsRouter);

app.use(errorHandler);

export default app;
