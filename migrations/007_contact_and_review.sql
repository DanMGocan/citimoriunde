BEGIN;
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK(target_type IN ('message','work','edition','copy','photo','member','member_review','book_review','topic','post','loan','service'));
ALTER TABLE copies ADD COLUMN reviewed_at timestamptz;
ALTER TABLE book_reviews ADD COLUMN reviewed_at timestamptz;
COMMIT;
