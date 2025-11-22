require('dotenv').config();
const mysql = require('mysql2/promise');

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'telegram_crypto_bot',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    connection.release();
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
  }
}

// Initialize database tables
async function initDB() {
  try {
    // Create database if it doesn't exist
    const tempPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    });
    
    await tempPool.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'telegram_crypto_bot'}`);
    await tempPool.end();
    
    // Now create tables
    await createTables();
    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function createTables() {
  const queries = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      display_name VARCHAR(255),
      email VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_telegram_id (telegram_id),
      INDEX idx_created_at (created_at)
    )`,
    
    // Subscriptions table
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      plan ENUM('monthly', 'yearly') NOT NULL,
      provider ENUM('telegram', 'stripe', 'invitemember') NOT NULL DEFAULT 'telegram',
      provider_payment_id VARCHAR(255),
      started_at TIMESTAMP NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      status ENUM('active', 'cancelled', 'expired', 'pending') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_expires_at (expires_at),
      INDEX idx_created_at (created_at)
    )`,
    
    // Referrals table
    `CREATE TABLE IF NOT EXISTS referrals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      referrer_user_id INT,
      referred_telegram_id BIGINT NOT NULL,
      code VARCHAR(255) NOT NULL,
      rewarded BOOLEAN DEFAULT FALSE,
      rewarded_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_referred (referred_telegram_id),
      INDEX idx_referrer_user_id (referrer_user_id),
      INDEX idx_referred_telegram_id (referred_telegram_id),
      INDEX idx_code (code),
      INDEX idx_rewarded (rewarded)
    )`,
    
    // Products table
    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sku VARCHAR(255) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      price_cents INT NOT NULL CHECK (price_cents > 0),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_sku (sku),
      INDEX idx_is_active (is_active)
    )`,
    
    // Purchases table
    `CREATE TABLE IF NOT EXISTS purchases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      product_id INT,
      provider_payment_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      INDEX idx_user_id (user_id),
      INDEX idx_product_id (product_id),
      INDEX idx_created_at (created_at)
    )`
    ,
    // Signal delivery logs (records when Telegram send succeeded but DB update failed or other delivery issues)
    `CREATE TABLE IF NOT EXISTS telegram_signal_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      signal_id VARCHAR(255) NULL,
      telegram_message_id BIGINT NULL,
      channel_id VARCHAR(255) NULL,
      error_message TEXT NULL,
      metadata JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_signal_id (signal_id),
      INDEX idx_channel_id (channel_id),
      INDEX idx_created_at (created_at)
    )`
  ];
  
  for (const query of queries) {
    await pool.execute(query);
  }
  
  // Insert default products
  await pool.execute(`
    INSERT IGNORE INTO products (sku, title, description, price_cents) VALUES
    ('crypto-ebook', 'Crypto Trading Masterclass eBook', 'Complete guide to crypto trading strategies and risk management', 1900),
    ('advanced-course', 'Advanced Trading Course', '8-week comprehensive crypto trading course with live sessions', 9900),
    ('one-on-one', '1-on-1 Trading Consultation', '60-minute personal consultation with expert trader', 19900)
  `);
}

// Execute query helper
async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('Database query error:', { sql, params, error: error.message });
    throw error;
  }
}

// Log a signal delivery failure or fallback record
async function logSignalDeliveryFailure({ signalId = null, telegramMessageId = null, channelId = null, errorMessage = null, metadata = null } = {}) {
  try {
    await query(
      `INSERT INTO telegram_signal_logs (signal_id, telegram_message_id, channel_id, error_message, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [signalId ? String(signalId) : null, telegramMessageId || null, channelId ? String(channelId) : null, errorMessage || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('Failed to write telegram_signal_logs entry:', err);
  }
}

// User management functions
async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  
  try {
    await query(
      `INSERT INTO users (telegram_id, username, display_name, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       display_name = VALUES(display_name),
       updated_at = NOW()`,
      [id, username, display_name]
    );
    
    const users = await query('SELECT * FROM users WHERE telegram_id = ?', [id]);
    return users[0];
  } catch (error) {
    console.error('Error upserting user:', error);
    throw error;
  }
}

async function getUserByTelegramId(telegramId) {
  const users = await query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  return users[0] || null;
}

// Subscription functions
async function createSubscriptionFromPayment(userInfo, payment) {
  try {
    // Ensure user exists
    await upsertUser(userInfo);
    const user = await getUserByTelegramId(userInfo.id);
    
    // Parse payment payload
    const payload = payment.invoice_payload;
    const isMonthly = payload.includes('monthly');
    const plan = isMonthly ? 'monthly' : 'yearly';
    
    const startedAt = new Date();
    const expiresAt = new Date();
    if (isMonthly) {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }
    
    await query(
      `INSERT INTO subscriptions (user_id, plan, provider, provider_payment_id, started_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, plan, 'telegram', payment.telegram_payment_charge_id, startedAt, expiresAt, 'active']
    );
    
    const subscriptions = await query(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    return subscriptions[0];
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
}

async function getActiveSubscription(telegramId) {
  const subscriptions = await query(
    `SELECT s.*, u.telegram_id, u.username, u.display_name
     FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE u.telegram_id = ? AND s.status = 'active' AND s.expires_at > NOW()
     ORDER BY s.expires_at DESC LIMIT 1`,
    [telegramId]
  );
  return subscriptions[0] || null;
}

// Referral functions
async function recordReferral(referredTelegramId, referralCode) {
  try {
    const match = referralCode.match(/^REF(\d+)/);
    if (!match) return null;
    
    const referrerTelegramId = parseInt(match[1]);
    const referrer = await getUserByTelegramId(referrerTelegramId);
    if (!referrer) return null;
    
    // Check if referral already exists
    const existing = await query(
      'SELECT id FROM referrals WHERE referred_telegram_id = ?',
      [referredTelegramId]
    );
    
    if (existing.length > 0) return null;
    
    await query(
      'INSERT INTO referrals (referrer_user_id, referred_telegram_id, code) VALUES (?, ?, ?)',
      [referrer.id, referredTelegramId, referralCode]
    );
    
    const referrals = await query('SELECT * FROM referrals WHERE referred_telegram_id = ?', [referredTelegramId]);
    return referrals[0];
  } catch (error) {
    console.error('Error recording referral:', error);
    return null;
  }
}

async function getReferralByUser(referredTelegramId) {
  const referrals = await query(
    `SELECT r.*, u.telegram_id as referrer_telegram_id, u.username as referrer_username
     FROM referrals r
     JOIN users u ON r.referrer_user_id = u.id
     WHERE r.referred_telegram_id = ?`,
    [referredTelegramId]
  );
  return referrals[0] || null;
}

async function getReferralStats(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { total_referrals: 0, total_rewards: 0, pending_rewards: 0 };
  
  const stats = await query(
    `SELECT 
       COUNT(*) as total_referrals,
       SUM(CASE WHEN rewarded = 1 THEN 1 ELSE 0 END) as total_rewards,
       SUM(CASE WHEN rewarded = 0 THEN 1 ELSE 0 END) as pending_rewards
     FROM referrals WHERE referrer_user_id = ?`,
    [user.id]
  );
  
  const result = stats[0] || {};
  return {
    total_referrals: parseInt(result.total_referrals) || 0,
    total_rewards: parseInt(result.total_rewards) || 0,
    pending_rewards: parseInt(result.pending_rewards) || 0
  };
}

async function rewardReferral(referralId) {
  return await query(
    'UPDATE referrals SET rewarded = 1, rewarded_at = NOW() WHERE id = ?',
    [referralId]
  );
}

// Admin functions
async function getUserStats() {
  const stats = await query(
    `SELECT 
       COUNT(*) as total_users,
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as new_users_24h,
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_users_7d
     FROM users`
  );
  return stats[0] || { total_users: 0, new_users_24h: 0, new_users_7d: 0 };
}

async function getSubscriptionStats() {
  const stats = await query(
    `SELECT 
       COUNT(*) as total_subscriptions,
       SUM(CASE WHEN status = 'active' AND expires_at > NOW() THEN 1 ELSE 0 END) as active_subscriptions,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_subscriptions,
       SUM(CASE WHEN status = 'active' AND expires_at <= NOW() THEN 1 ELSE 0 END) as expired_subscriptions,
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as new_subscriptions_24h
     FROM subscriptions`
  );
  return stats[0] || { total_subscriptions: 0, active_subscriptions: 0, cancelled_subscriptions: 0, expired_subscriptions: 0, new_subscriptions_24h: 0 };
}

async function getRevenueStats() {
  const monthlyPrice = 25;
  const yearlyPrice = 250;
  
  const stats = await query(
    `SELECT 
       SUM(CASE WHEN plan = 'monthly' THEN ${monthlyPrice} WHEN plan = 'yearly' THEN ${yearlyPrice} ELSE 0 END) as total_revenue,
       SUM(CASE 
         WHEN plan = 'monthly' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN ${monthlyPrice}
         WHEN plan = 'yearly' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN ${yearlyPrice}
         ELSE 0 END) as revenue_24h,
       SUM(CASE 
         WHEN plan = 'monthly' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN ${monthlyPrice}
         WHEN plan = 'yearly' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN ${yearlyPrice}
         ELSE 0 END) as revenue_30d
     FROM subscriptions
     WHERE status IN ('active', 'cancelled')`
  );
  
  return stats[0] || { total_revenue: 0, revenue_24h: 0, revenue_30d: 0 };
}

async function getPremiumInviteLink() {
  return process.env.PREMIUM_CHANNEL_INVITE_LINK || 'https://t.me/+mock_premium_link';
}

// Additional helper functions
async function getUserSubscriptions(telegramId) {
  return await query(
    `SELECT s.*
     FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE u.telegram_id = ?
     ORDER BY s.created_at DESC`,
    [telegramId]
  );
}

async function cancelSubscription(subscriptionId) {
  await query(
    'UPDATE subscriptions SET status = ?, updated_at = NOW() WHERE id = ?',
    ['cancelled', subscriptionId]
  );
  
  const subscriptions = await query('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
  return subscriptions[0];
}

// Initialize database on module load
initDB().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
  await pool.end();
  console.log('Database pool closed');
});

process.on('SIGTERM', async () => {
  console.log('Closing database pool...');
  await pool.end();
  console.log('Database pool closed');
});

module.exports = {
  initDB,
  testConnection,
  query,
  
  // User functions
  upsertUser,
  getUserByTelegramId,
  
  // Subscription functions
  createSubscriptionFromPayment,
  getActiveSubscription,
  getUserSubscriptions,
  cancelSubscription,
  
  // Referral functions
  recordReferral,
  getReferralByUser,
  getReferralStats,
  rewardReferral,
  
  // Admin functions
  getUserStats,
  getSubscriptionStats,
  getRevenueStats,
  getPremiumInviteLink
  ,
  // Signal delivery logging
  logSignalDeliveryFailure
};
