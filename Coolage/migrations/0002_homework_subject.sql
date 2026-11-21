-- Existing homework is classified as General; new assignments require a subject.
ALTER TABLE homework ADD COLUMN subject TEXT NOT NULL DEFAULT 'General';
