import nodemailer, { Transporter } from 'nodemailer';

import config from '../config';

let transporter: Transporter | null = null;

export function getTransport(): Transporter {
  if (transporter) return transporter;

  transporter =
    config.env === 'test'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: config.smtp.user
            ? { user: config.smtp.user, pass: config.smtp.password }
            : undefined,
        });

  return transporter;
}
