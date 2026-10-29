ALTER TABLE copies ADD COLUMN moderation_state text NOT NULL DEFAULT 'APPROVED'
  CHECK (moderation_state IN ('APPROVED','HIDDEN'));
ALTER TABLE copies ADD CONSTRAINT copies_hidden_private
  CHECK (moderation_state <> 'HIDDEN' OR visibility = 'PRIVATE');

CREATE TABLE member_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text NOT NULL REFERENCES members(id),
  actor_id text NOT NULL REFERENCES members(id),
  library_id uuid REFERENCES libraries(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_warnings_member_created ON member_warnings(member_id,created_at DESC);

CREATE UNIQUE INDEX privacy_requests_one_pending
  ON privacy_requests(member_id,kind) WHERE state IN ('RECEIVED','REVIEWING');
