-- Signal C: propagate Cloudflare Access identity into audit trail
ALTER TABLE sandbox_events ADD COLUMN identity TEXT;
ALTER TABLE usage_metrics  ADD COLUMN identity TEXT;
