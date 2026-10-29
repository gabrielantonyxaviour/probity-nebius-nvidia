// Better Auth, built per request because the D1 binding only exists inside a handler.
import { betterAuth } from "better-auth";
import { emailOTP, organization } from "better-auth/plugins";
import { sendEmail, type SendResult } from "../email";
import { signInCodeEmail } from "../email/templates";
import { LOCAL_ORIGIN, type CEnv } from "./types";

/** `sink.failure` is set when the sign-in code could not be sent; Better Auth swallows errors thrown from sendVerificationOTP, so the route reads this instead. */
export function makeAuth(env: CEnv, sink: { failure?: SendResult } = {}) {
  const secure = env.APP_URL.startsWith("https://");
  return betterAuth({
    database: env.DB,
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL, LOCAL_ORIGIN],
    advanced: {
      cookiePrefix: "probity",
      useSecureCookies: secure,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      defaultCookieAttributes: { sameSite: "lax", path: "/", secure, httpOnly: true },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: { "/email-otp/send-verification-otp": { window: 60, max: 3 }, "/sign-in/email-otp": { window: 60, max: 10 } },
    },
    databaseHooks: {
      session: {
        create: {
          // A returning user lands in their first workspace without an extra call.
          before: async (s) => {
            const row = await env.DB.prepare('SELECT organizationId FROM member WHERE userId = ? ORDER BY createdAt ASC LIMIT 1').bind(s.userId).first<{ organizationId: string }>();
            return { data: { ...s, activeOrganizationId: row?.organizationId ?? null } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;
          // Awaited inside the request (no background handler is set), so a missing or refused sender is known before the response.
          const sent = await sendEmail(env, { to: email, ...signInCodeEmail(otp), noOutbox: true });
          if (!sent.ok) sink.failure = sent;
        },
      }),
      organization({
        creatorRole: "owner",
        organizationLimit: 5,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            await env.DB.prepare("INSERT OR IGNORE INTO org_profile (org_id, plan, plan_status, created_at) VALUES (?, 'free', 'none', ?)").bind(org.id, new Date().toISOString()).run();
          },
        },
      }),
    ],
  });
}
export type Auth = ReturnType<typeof makeAuth>;
