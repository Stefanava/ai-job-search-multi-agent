// Sends a plain-text summary email via SMTP. Built for evalQuery.js's
// auto-review runs (see build-vs-buy-eval/run_variant.js's post-run
// summary), so an automated comparison run's rejections and near-misses
// don't just sit in a JSON file nobody opens. Nothing about this is
// eval-specific except how it's currently wired up - it would work equally
// well for a real scan.js run if you want the same summary day to day
// later.
//
// Configure via .env (see .env.example): SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, EMAIL_FROM, EMAIL_TO. Works with Gmail SMTP + an app password,
// or any SMTP provider (Resend, Postmark, SES, etc.) - deliberately not
// tied to one vendor's API.
//
// If any of these aren't set, sendSummaryEmail logs a warning and returns
// { sent: false } rather than throwing - a missing email config should
// never break an eval run over something this optional. The caller is
// expected to still write the same summary to disk regardless of whether
// the email actually sends.

import nodemailer from "nodemailer";

export async function sendSummaryEmail({ subject, text }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) {
    console.warn(
      "[mailer] Email not configured (SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM/EMAIL_TO in .env) - " +
        "skipping send. The summary above/below was still generated, just not emailed."
    );
    return { sent: false };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({ from: EMAIL_FROM, to: EMAIL_TO, subject, text });
  return { sent: true };
}
