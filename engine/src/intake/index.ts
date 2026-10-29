// Intake module (Sonnet A): turns an incoming vendor e-mail (from Gmail or Outlook via B's webhook) into a request and starts its check.
export type IncomingEmail = {
  orgId: string;
  source: "gmail" | "outlook";
  messageId: string;
  from: string;
  replyTo: string | null;
  subject: string;
  receivedAt: string;
  text: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType: string; bytes: ArrayBuffer }[];
};
