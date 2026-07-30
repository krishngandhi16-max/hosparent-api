-- Migration: Add Hoser audit trail column
-- Purpose: Track which data was inserted/recommended by Hoser autonomous agent
-- Safe: Non-destructive, nullable column, no data deletion

ALTER TABLE prices ADD COLUMN IF NOT EXISTS inserted_by VARCHAR(255);
ALTER TABLE prices ADD COLUMN IF NOT EXISTS hoser_recommendation VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_prices_inserted_by ON prices(inserted_by);

-- Example insert pattern for Hoser:
-- INSERT INTO prices (hospital_id, procedure_id, price, price_type, payer_name, inserted_by)
-- VALUES (123, 456, 1500.00, 'cash', 'self-pay', 'hoser_2026-07-16T14:23:45Z_HOPD-Baylor-MRF')
-- ON CONFLICT DO NOTHING;

COMMENT ON COLUMN prices.inserted_by IS 'Audit trail: who inserted this record (e.g., hoser_TIMESTAMP_SOURCE)';
COMMENT ON COLUMN prices.hoser_recommendation IS 'Hoser context: why this price was recommended';
