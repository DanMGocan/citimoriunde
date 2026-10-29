BEGIN;
CREATE TABLE "rateLimit" (id text PRIMARY KEY, key text UNIQUE NOT NULL, count int NOT NULL DEFAULT 0, "lastRequest" bigint NOT NULL);
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" int NOT NULL DEFAULT 0;
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" timestamptz;
COMMIT;
