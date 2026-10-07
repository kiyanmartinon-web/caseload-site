// Sending email (password-reset codes) over SMTP.
// Netlify environment variables:
//   SMTP_USER  (required) the mailbox that sends, e.g. admin@case-bound.com
//   SMTP_PASS  (required) its password — for Google, a 16-letter App Password
//   SMTP_HOST  (optional) default smtp.gmail.com
//   SMTP_PORT  (optional) default 465 (TLS)
//   MAIL_FROM  (optional) default "Casebound <SMTP_USER>"
export const mailConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail({ to, subject, text, html }) {
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || `Casebound <${process.env.SMTP_USER}>`,
    to, subject, text, html,
  });
}
