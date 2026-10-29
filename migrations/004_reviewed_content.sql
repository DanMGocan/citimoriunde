BEGIN;
ALTER TABLE works ADD COLUMN reviewed_at timestamptz;
CREATE INDEX forum_post_search ON forum_posts USING gin(body gin_trgm_ops);
COMMIT;
