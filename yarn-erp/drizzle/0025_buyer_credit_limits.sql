-- 0025_buyer_credit_limits.sql: optional per-buyer credit limit. NULL means no limit. Warn-only:
-- nothing reads these columns to block a quote or invoice. Additive only; existing buyers keep NULL.
ALTER TABLE buyers ADD COLUMN credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR credit_limit_minor>=0);
ALTER TABLE buyers ADD COLUMN credit_limit_currency TEXT CHECK(credit_limit_currency IS NULL OR credit_limit_currency IN ('PKR','USD','EUR','GBP'));
-- An amount and a currency are set together or cleared together.
CREATE TRIGGER buyer_credit_limit_pair_insert BEFORE INSERT ON buyers
WHEN (NEW.credit_limit_minor IS NULL)!=(NEW.credit_limit_currency IS NULL)
BEGIN SELECT RAISE(ABORT,'A credit limit needs both an amount and a currency.'); END;
CREATE TRIGGER buyer_credit_limit_pair_update BEFORE UPDATE OF credit_limit_minor, credit_limit_currency ON buyers
WHEN (NEW.credit_limit_minor IS NULL)!=(NEW.credit_limit_currency IS NULL)
BEGIN SELECT RAISE(ABORT,'A credit limit needs both an amount and a currency.'); END;
