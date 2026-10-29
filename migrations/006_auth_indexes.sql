BEGIN;
CREATE INDEX IF NOT EXISTS account_user_idx ON account("userId");
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_user_idx ON "twoFactor"("userId");
CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON "twoFactor"(secret);
COMMIT;
