BEGIN;
CREATE TABLE integration_usage (provider text NOT NULL, period text NOT NULL, requests int NOT NULL DEFAULT 0, reserved_cents int NOT NULL DEFAULT 0, PRIMARY KEY(provider,period));
CREATE TABLE edition_cover_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), edition_id uuid NOT NULL REFERENCES editions(id), photo_id uuid NOT NULL REFERENCES copy_photos(id), member_id text NOT NULL REFERENCES members(id), rights_confirmed boolean NOT NULL CHECK(rights_confirmed), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED')), created_at timestamptz NOT NULL DEFAULT now());
COMMIT;
