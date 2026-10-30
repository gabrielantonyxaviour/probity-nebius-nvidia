import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms · Probity" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="30 October 2026" sections={[
      { h: "The service", p: ["Probity is provided by Larinova Private Limited. It checks vendor bank-change requests and recommends whether to approve, call back or hold a change. By creating an account you accept these terms on behalf of your company."] },
      { h: "Probity advises; you decide", p: ["Probity's verdicts are decision support. Your company remains responsible for every payment it makes and for following its own payment controls, including calling vendors back. Always call on a number that did not come from the request."] },
      { h: "Accounts and workspaces", p: ["Keep your sign-in e-mail secure. Owners and admins of a workspace control its connections, schedule and plan, and are responsible for who they invite."] },
      { h: "Plans and billing", p: ["The Free plan is free. Probity Plus is billed monthly per company through Dodo Payments, our merchant of record, in US dollars plus applicable tax. You can cancel at any time from Settings; Probity Plus stays active until the end of the paid month. Fees already paid are not refunded except where the law requires."] },
      { h: "Acceptable use", p: ["Use Probity only for your own company's payments and vendor records. Do not upload data you have no right to process, attempt to break other workspaces' separation, or overload the service."] },
      { h: "Connected accounts", p: ["When you connect Gmail, Outlook, Xero or Slack, you authorise Probity to read and write only what the feature needs. You can disconnect at any time in Settings."] },
      { h: "Availability and liability", p: ["We work to keep Probity available and accurate but provide it as is. To the extent the law allows, our total liability for any claim is limited to the fees you paid in the three months before it, and we are not liable for indirect losses or for payments your company chose to make."] },
      { h: "Changes and contact", p: ["We will e-mail workspace owners before material changes take effect. Questions: gabrielantony56@gmail.com. These terms are governed by the laws of India."] },
    ]} />
  );
}
