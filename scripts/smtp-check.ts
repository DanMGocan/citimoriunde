import { config } from "../src/lib/config";
import { createMailTransport } from "../src/lib/mail";

let transport: ReturnType<typeof createMailTransport> = null;
let interrupted = false;
const stop = () => {
  interrupted = true;
  process.exitCode = 130;
  transport?.close();
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);

try {
  transport = createMailTransport(config, false);
  if (!transport) {
    console.error("SMTP is disabled or incomplete. Configure MAIL_MODE, SMTP_HOST and SMTP_FROM before checking it.");
    process.exitCode = 1;
  } else {
    await transport.verify();
    if (!interrupted) {
      console.log(`SMTP connection and TLS verification passed${config.smtpUser ? ", including authentication" : ""}. No email was sent.`);
      console.log("Sender acceptance and delivery remain unverified; this check does not send a message.");
    }
  }
} catch {
  // Provider errors may contain login names, recipients or credential-bearing URLs.
  console.error(interrupted ? "SMTP verification was interrupted; details redacted." : "SMTP verification failed; details redacted. Check network access, credentials and TLS configuration.");
  if (!interrupted) process.exitCode = 1;
} finally {
  transport?.close();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, stop);
}
