-- Telegram Crypto Bot Database Schema
-- Run this script to set up the database tables

-- Create database (run this separately if needed)
-- CREATE DATABASE telegram_crypto_bot;

-- Use the database
-- \c telegram_crypto_bot;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on telegram_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  provider TEXT NOT NULL DEFAULT 'telegram' CHECK (provider IN ('telegram', 'stripe', 'invitemember')),
  provider_payment_id TEXT,
  started_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes on subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions(created_at);

-- Referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  referred_telegram_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  rewarded BOOLEAN DEFAULT FALSE,
  rewarded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes on referrals
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_user_id ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_telegram_id ON referrals(referred_telegram_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_rewarded ON referrals(rewarded);

-- Products table (for one-off purchases like eBooks)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on products
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- Purchases table (for one-off product purchases)
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  provider_payment_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes on purchases
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at);

-- Payment logs table (for tracking all payment events)
CREATE TABLE IF NOT EXISTS payment_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  payload TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes on payment_logs
CREATE INDEX IF NOT EXISTS idx_payment_logs_user_id ON payment_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_provider_payment_id ON payment_logs(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_status ON payment_logs(status);
CREATE INDEX IF NOT EXISTS idx_payment_logs_created_at ON payment_logs(created_at);

-- Bot analytics table (for tracking bot usage)
CREATE TABLE IF NOT EXISTS bot_analytics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes on bot_analytics
CREATE INDEX IF NOT EXISTS idx_bot_analytics_user_id ON bot_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_analytics_event_type ON bot_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_bot_analytics_created_at ON bot_analytics(created_at);

-- Insert default products
INSERT INTO products (sku, title, description, price_cents) VALUES
  ('crypto-ebook', 'Crypto Trading Masterclass eBook', 'Complete guide to crypto trading strategies and risk management', 1900),
  ('advanced-course', 'Advanced Trading Course', '8-week comprehensive crypto trading course with live sessions', 9900),
  ('one-on-one', '1-on-1 Trading Consultation', '60-minute personal consultation with expert trader', 19900)
ON CONFLICT (sku) DO NOTHING;

-- Create a function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic updated_at updates
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a view for active subscriptions
CREATE OR REPLACE VIEW active_subscriptions AS
SELECT 
  s.*,
  u.telegram_id,
  u.username,
  u.display_name,
  (s.expires_at > NOW()) AS is_currently_active
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE s.status = 'active';

-- Create a view for referral statistics
CREATE OR REPLACE VIEW referral_stats AS
SELECT 
  u.id as user_id,
  u.telegram_id,
  u.username,
  u.display_name,
  COUNT(r.id) as total_referrals,
  COUNT(r.id) FILTER (WHERE r.rewarded = true) as successful_referrals,
  COUNT(r.id) FILTER (WHERE r.rewarded = false) as pending_referrals,
  SUM(CASE WHEN r.rewarded = true THEN 3 ELSE 0 END) as total_reward_days
FROM users u
LEFT JOIN referrals r ON u.id = r.referrer_user_id
GROUP BY u.id, u.telegram_id, u.username, u.display_name;

-- Create a function to clean up expired data (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_data(days_to_keep INTEGER DEFAULT 365)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Clean up old bot analytics (keep last year by default)
  DELETE FROM bot_analytics 
  WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Clean up old payment logs (keep last 2 years for financial records)
  DELETE FROM payment_logs 
  WHERE created_at < NOW() - INTERVAL '1 day' * (days_to_keep * 2)
    AND status IN ('failed', 'refunded');
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for better performance on large datasets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_composite 
ON subscriptions(user_id, status, expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_composite 
ON referrals(referrer_user_id, rewarded, created_at);

-- Add some constraints for data integrity
ALTER TABLE subscriptions 
ADD CONSTRAINT chk_expires_after_start 
CHECK (expires_at > started_at);

ALTER TABLE referrals 
ADD CONSTRAINT chk_rewarded_at_consistency 
CHECK ((rewarded = true AND rewarded_at IS NOT NULL) OR (rewarded = false AND rewarded_at IS NULL));

-- Create a unique constraint to prevent duplicate referrals
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique_referred 
ON referrals(referred_telegram_id);

-- Insert some sample data for testing (remove in production)
-- INSERT INTO users (telegram_id, username, display_name) VALUES
--   (123456789, 'testuser1', 'Test User 1'),
--   (987654321, 'testuser2', 'Test User 2')
-- ON CONFLICT (telegram_id) DO NOTHING;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO your_app_user;

-- Display table information
SELECT 
  table_name, 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'subscriptions', 'referrals', 'products', 'purchases', 'payment_logs', 'bot_analytics')
ORDER BY table_name, ordinal_position;

-- Display indexes
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('users', 'subscriptions', 'referrals', 'products', 'purchases', 'payment_logs', 'bot_analytics')
ORDER BY tablename, indexname;

NOTIFY setup_complete, 'Database schema setup completed successfully';
