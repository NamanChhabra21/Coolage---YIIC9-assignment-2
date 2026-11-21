-- Allow a browser to safely retry a school request after an interrupted response.
-- Older requests retain a NULL request_key, so existing data is preserved.
ALTER TABLE school_requests ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_requests_request_key ON school_requests(request_key);
