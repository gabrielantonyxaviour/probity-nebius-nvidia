-- Better Auth 1.7.x schema for D1 (emailOTP + organization plugins, database rate limiter), generated with getMigrations().
-- One organisation = one company workspace. org_profile holds the plan; org_demo is the shared demo company.

CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" integer NOT NULL, "image" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL);
CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" date NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" date NOT NULL, "updatedAt" date NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "activeOrganizationId" text);
CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date NOT NULL, "updatedAt" date NOT NULL);
CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" date NOT NULL, "createdAt" date NOT NULL, "updatedAt" date NOT NULL);
CREATE TABLE IF NOT EXISTS "organization" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "slug" text NOT NULL UNIQUE, "logo" text, "createdAt" date NOT NULL, "metadata" text);
CREATE TABLE IF NOT EXISTS "member" ("id" text NOT NULL PRIMARY KEY, "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "role" text NOT NULL, "createdAt" date NOT NULL);
CREATE TABLE IF NOT EXISTS "invitation" ("id" text NOT NULL PRIMARY KEY, "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE, "email" text NOT NULL, "role" text, "status" text NOT NULL, "expiresAt" date NOT NULL, "createdAt" date NOT NULL, "inviterId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS "rateLimit" ("id" text NOT NULL PRIMARY KEY, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "lastRequest" bigint NOT NULL);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "member" ("organizationId");
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "member" ("userId");
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation" ("organizationId");
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");

CREATE TABLE IF NOT EXISTS org_profile (
  org_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',            -- free | pro
  plan_status TEXT NOT NULL DEFAULT 'none',     -- none | active | on_hold | cancelled | failed
  plan_renews_at TEXT,                          -- next billing date, or the end of a judge grant
  dodo_customer_id TEXT,
  dodo_subscription_id TEXT,
  plan_updated_at TEXT,                         -- time of the latest billing event applied (older events are ignored)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_profile_customer ON org_profile(dodo_customer_id);
CREATE INDEX IF NOT EXISTS idx_org_profile_subscription ON org_profile(dodo_subscription_id);

-- The shared demo company: the synthetic buyer in the letters. Everyone who is not signed in sees it.
INSERT OR IGNORE INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('org_demo', 'Halvorsen Mission Systems (demo)', 'halvorsen-mission-systems-demo', '2026-10-30T00:00:00.000Z');
INSERT OR IGNORE INTO org_profile (org_id, plan, plan_status, created_at) VALUES ('org_demo', 'pro', 'active', '2026-10-30T00:00:00.000Z');
