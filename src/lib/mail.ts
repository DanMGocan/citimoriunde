import nodemailer, { type SMTPTransportOptions } from "nodemailer";
import { config, type AppConfig } from "./config";

export type MailSettings = Pick<AppConfig,
  "mailMode" | "smtpHost" | "smtpPort" | "smtpSecure" | "smtpRequireTls" |
  "smtpUser" | "smtpPassword" | "smtpFrom" | "smtpDnsTimeoutMs" |
  "smtpConnectTimeoutMs" | "smtpGreetingTimeoutMs" | "smtpSocketTimeoutMs"
>;

/** Only callers creating a transport may access these server-only credentials. */
export function smtpTransportOptions(settings: MailSettings = config): SMTPTransportOptions | null {
  if (settings.mailMode !== "smtp" || !settings.smtpHost || !settings.smtpFrom) return null;
  if (!settings.smtpRequireTls) throw new Error("SMTP_TLS_REQUIRED");
  if (Boolean(settings.smtpUser) !== Boolean(settings.smtpPassword)) throw new Error("SMTP_AUTH_INCOMPLETE");
  return {
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    requireTLS: true,
    ignoreTLS: false,
    opportunisticTLS: false,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: settings.smtpHost },
    ...(settings.smtpUser ? { auth: { user: settings.smtpUser, pass: settings.smtpPassword } } : {}),
    forceAuth: Boolean(settings.smtpUser),
    dnsTimeout: settings.smtpDnsTimeoutMs,
    connectionTimeout: settings.smtpConnectTimeoutMs,
    greetingTimeout: settings.smtpGreetingTimeoutMs,
    socketTimeout: settings.smtpSocketTimeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
    logger: false,
    debug: false,
    transactionLog: false,
  };
}

/** One SMTP connection for the worker; the diagnostic uses an unpooled connection. */
export function createMailTransport(settings: MailSettings = config, pooled = true) {
  const options = smtpTransportOptions(settings);
  if (!options) return null;
  return pooled
    ? nodemailer.createTransport({ ...options, pool: true, maxConnections: 1, maxMessages: 20 })
    : nodemailer.createTransport(options);
}
