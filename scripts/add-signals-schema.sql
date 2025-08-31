-- Add signal preferences and signals management to existing schema

-- Add signal preferences to users table
ALTER TABLE users ADD COLUMN signal_preferences JSON;
ALTER TABLE users ADD COLUMN preferred_markets VARCHAR(255) DEFAULT 'both'; -- 'crypto', 'forex', 'both'

-- Create signals table
CREATE TABLE IF NOT EXISTS signals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  market_type ENUM('crypto', 'forex') NOT NULL,
  signal_type ENUM('long', 'short') NOT NULL,
  pair VARCHAR(50) NOT NULL, -- e.g., 'BTC/USDT', 'EUR/USD'
  entry_price DECIMAL(20, 8) NOT NULL,
  stop_loss DECIMAL(20, 8) NOT NULL,
  take_profit DECIMAL(20, 8) NOT NULL,
  confidence_level INT DEFAULT 75, -- percentage 1-100
  risk_level ENUM('low', 'medium', 'high') DEFAULT 'medium',
  status ENUM('active', 'hit_tp', 'hit_sl', 'cancelled') DEFAULT 'active',
  reasoning TEXT, -- explanation for the signal
  author VARCHAR(255), -- who created the signal
  is_premium BOOLEAN DEFAULT TRUE, -- false for free signals
  sent_to_premium BOOLEAN DEFAULT FALSE,
  sent_to_free BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL, -- when signal expires
  
  INDEX idx_market_type (market_type),
  INDEX idx_signal_type (signal_type),
  INDEX idx_pair (pair),
  INDEX idx_status (status),
  INDEX idx_is_premium (is_premium),
  INDEX idx_created_at (created_at)
);

-- Create signal delivery tracking
CREATE TABLE IF NOT EXISTS signal_deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  signal_id INT,
  user_id INT,
  delivery_method ENUM('telegram', 'email', 'webhook') DEFAULT 'telegram',
  delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  
  INDEX idx_signal_id (signal_id),
  INDEX idx_user_id (user_id),
  INDEX idx_delivered_at (delivered_at)
);

-- Create signal performance tracking
CREATE TABLE IF NOT EXISTS signal_performance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  signal_id INT,
  outcome ENUM('win', 'loss', 'breakeven', 'partial') NOT NULL,
  profit_loss_percentage DECIMAL(8, 4), -- e.g., 5.25 for 5.25% gain
  closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
  
  INDEX idx_signal_id (signal_id),
  INDEX idx_outcome (outcome),
  INDEX idx_closed_at (closed_at)
);

-- Insert sample signals for testing
INSERT INTO signals (market_type, signal_type, pair, entry_price, stop_loss, take_profit, confidence_level, risk_level, reasoning, author, is_premium) VALUES
-- Crypto signals
('crypto', 'long', 'BTC/USDT', 73500.00, 71200.00, 76800.00, 85, 'medium', 'Strong support at 72k level, bullish momentum confirmed by volume', 'ArodonnaAnalyst', TRUE),
('crypto', 'short', 'ETH/USDT', 3420.00, 3580.00, 3180.00, 78, 'medium', 'Resistance at 3450, bearish divergence on RSI', 'ArodonnaAnalyst', TRUE),
('crypto', 'long', 'ADA/USDT', 0.4850, 0.4600, 0.5200, 72, 'low', 'Accumulation phase completed, breakout expected', 'ArodonnaAnalyst', FALSE),

-- Forex signals  
('forex', 'long', 'EUR/USD', 1.0450, 1.0380, 1.0580, 82, 'medium', 'ECB dovish stance creating support, USD weakness expected', 'ArodonnaAnalyst', TRUE),
('forex', 'short', 'GBP/JPY', 195.50, 197.20, 192.80, 88, 'high', 'Brexit uncertainty + BoJ intervention risk', 'ArodonnaAnalyst', TRUE),
('forex', 'long', 'USD/CAD', 1.3820, 1.3750, 1.3950, 75, 'low', 'Oil price decline supporting USD strength vs CAD', 'ArodonnaAnalyst', FALSE);

-- Update user preferences example
-- UPDATE users SET preferred_markets = 'crypto', signal_preferences = '{"timeframes": ["4h", "1d"], "risk_tolerance": "medium", "max_signals_per_day": 3}' WHERE id = 1;
