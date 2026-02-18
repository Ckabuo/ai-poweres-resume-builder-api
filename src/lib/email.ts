import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@example.com';

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export function isEmailConfigured(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getPasswordResetTemplate(resetLink: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 40px 32px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <span style="font-size: 24px; font-weight: 700; color: #1e293b;">AI Resume Builder</span>
              </div>
              <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #1e293b;">Reset your password</h1>
              <p style="margin: 0 0 24px; font-size: 15px; color: #64748b;">You requested a password reset for your account. Click the button below to set a new password. This link expires in 1 hour.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 8px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px; font-size: 13px; color: #94a3b8;">Or copy and paste this link:</p>
              <p style="margin: 0 0 24px; font-size: 12px; word-break: break-all; color: #64748b;">${resetLink}</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">If you didn&apos;t request this, you can safely ignore this email. Your password will remain unchanged.</p>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8;">© ${new Date().getFullYear()} AI Resume Builder. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = `Reset your password - AI Resume Builder

You requested a password reset for your account. Click the link below to set a new password (valid for 1 hour).

${resetLink}

If you didn't request this, you can safely ignore this email. Your password will remain unchanged.`;
  return { html, text };
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  }

  const { html, text } = getPasswordResetTemplate(resetLink);

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Reset your password - AI Resume Builder',
    html,
    text,
  });
}
