import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy · Probity" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="30 October 2026" sections={[
      { h: "Who we are", p: ["Probity is operated by Larinova Private Limited (\"we\"). Write to gabrielantony56@gmail.com about anything in this policy."] },
      { h: "What Probity is for", p: ["Probity checks vendor requests to change bank or remittance details before a payment run, and tells your accounts-payable team to approve, call back or hold. We process data only to provide that service to the company that signed up."] },
      { h: "What we store", p: [
        "Your account: your e-mail address and the company workspaces you belong to.",
        "Requests and checks: the bank-change e-mails and letters Probity checks, the facts it found, every model call and the decision, so your auditors can see why a payment was approved or held. Bank account numbers are stored only as their last four digits and a one-way hash.",
        "Connections: when you connect Gmail, Outlook, Xero or Slack, we keep the connection itself (through Composio for Gmail, Outlook and Xero; directly for Slack) so Probity can read new vendor e-mails, your vendor list and open bills, and post verdicts.",
      ] },
      { h: "What we do not store", p: ["E-mails that are not vendor bank-change requests. Each new message is screened, and anything else is ignored and never saved. We do not sell data, show ads, or use your data to train AI models."] },
      { h: "Who processes it for us", p: [
        "Cloudflare (hosting, database, file storage, e-mail sending) · Nebius Token Factory and Nebius AI Cloud (the NVIDIA Nemotron models and NeMo Guardrails that read and screen requests) · Composio (Gmail, Outlook and Xero connections) · Tavily (looking up a vendor's own website) · Dodo Payments (billing, as merchant of record) · Slack, Google, Microsoft and Xero, only for the accounts you connect.",
        "Public registries (SEC EDGAR, USAspending, GLEIF) receive only the vendor's company name.",
      ] },
      { h: "How long we keep it", p: ["For as long as your workspace exists. Delete a connection in Settings and Probity stops reading it immediately. Ask us to delete your workspace and we remove its requests, checks and connections within 30 days, except what the law requires us to keep for billing."] },
      { h: "Your rights", p: ["You can ask to see, correct, export or delete your data at any time by e-mailing gabrielantony56@gmail.com from your account's address."] },
      { h: "Security", p: ["Every workspace's data is kept separate from every other's, all traffic is encrypted, secrets are held only as platform secrets, and every Slack, Dodo and job callback is signature-checked."] },
    ]} />
  );
}
