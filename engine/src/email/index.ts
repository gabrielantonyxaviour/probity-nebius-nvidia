// E-mail module (Sonnet C): sendEmail() for sign-in codes, hold alerts and the pre-run summary.
export type OutgoingEmail = { to: string[]; subject: string; text: string; html?: string };
