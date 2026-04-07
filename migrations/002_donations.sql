-- Donations table for donation intent persistence
-- Run: turso db shell donor-compass < migrations/002_donations.sql

CREATE TABLE IF NOT EXISTS donations (
    id TEXT PRIMARY KEY,
    ref_id TEXT NOT NULL,
    email TEXT NOT NULL,
    form_data TEXT NOT NULL,
    memo TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_donations_ref_id ON donations(ref_id);
CREATE INDEX IF NOT EXISTS idx_donations_email ON donations(email);
