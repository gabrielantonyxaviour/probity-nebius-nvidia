import "@/components/landing/landing.css";
import "@/components/auth/auth.css";

/** Sign-in and sign-up: a full-screen page of its own, no site header or footer. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <style>{"html, body { background: #0c0c0b; }"}</style>
      {children}
    </div>
  );
}
