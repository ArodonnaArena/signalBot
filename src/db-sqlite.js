require('dotenv').config();
const Database = require('sqlite3').Database;
const { promisify } = require('util');

let db;

// Initialize SQLite database
function initDB() {
  return new Promise((resolve, reject) => {
    db = new Database('./bot.db', (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
      } else {
        console.log('Connected to SQLite database');
        setupTables().then(resolve).catch(reject);
      }
    });
  });
}

// Setup database tables
async function setupTables() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      display_name TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      plan TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
      provider TEXT NOT NULL DEFAULT 'telegram',
      provider_payment_id TEXT,
      started_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER REFERENCES users(id),
      referred_telegram_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      rewarded BOOLEAN DEFAULT 0,
      rewarded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      provider_payment_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Insert default products
    `INSERT OR IGNORE INTO products (sku, title, description, price_cents) VALUES
      ('crypto-ebook', 'Crypto Trading Masterclass eBook', 'Complete guide to crypto trading strategies and risk management', 1900),
      ('advanced-course', 'Advanced Trading Course', '8-week comprehensive crypto trading course with live sessions', 9900),
      ('one-on-one', '1-on-1 Trading Consultation', '60-minute personal consultation with expert trader', 19900)`
  ];
  
  for (const query of queries) {
    await runQuery(query);
  }
  
  console.log('Database tables created successfully');
}

// Promisified database run
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error('SQL Error:', err);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
};

// Promisified database get
const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('SQL Error:', err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

// Promisified database all
const allQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('SQL Error:', err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// User management functions
async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  
  try {
    await runQuery(
      `INSERT OR REPLACE INTO users (telegram_id, username, display_name, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, username, display_name]
    );
    
    return await getQuery('SELECT * FROM users WHERE telegram_id = ?', [id]);
  } catch (error) {
    console.error('Error upserting user:', error);
    throw error;
  }
}

async function getUserByTelegramId(telegramId) {
  return await getQuery('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
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
    
    const startedAt = new Date().toISOString();
    const expiresAt = new Date();
    if (isMonthly) {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }
    
    await runQuery(
      `INSERT INTO subscriptions (user_id, plan, provider, provider_payment_id, started_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, plan, 'telegram', payment.telegram_payment_charge_id, startedAt, expiresAt.toISOString(), 'active']
    );
    
    return await getQuery('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [user.id]);
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
}

async function getActiveSubscription(telegramId) {
  return await getQuery(
    `SELECT s.*, u.telegram_id, u.username, u.display_name
     FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE u.telegram_id = ? AND s.status = 'active' AND s.expires_at > datetime('now')
     ORDER BY s.expires_at DESC LIMIT 1`,
    [telegramId]
  );
}

// Referral functions
async function recordReferral(referredTelegramId, referralCode) {
  try {
    const match = referralCode.match(/^REF(\d+)/);
    if (!match) return null;
    
    const referrerTelegramId = parseInt(match[1]);
    const referrer = await getUserByTelegramId(referrerTelegramId);
    if (!referrer) return null;
    
    await runQuery(
      'INSERT INTO referrals (referrer_user_id, referred_telegram_id, code) VALUES (?, ?, ?)',
      [referrer.id, referredTelegramId, referralCode]
    );
    
    return await getQuery('SELECT * FROM referrals WHERE referred_telegram_id = ?', [referredTelegramId]);
  } catch (error) {
    console.error('Error recording referral:', error);
    return null;
  }
}

async function getReferralByUser(referredTelegramId) {
  return await getQuery(
    `SELECT r.*, u.telegram_id as referrer_telegram_id, u.username as referrer_username
     FROM referrals r
     JOIN users u ON r.referrer_user_id = u.id
     WHERE r.referred_telegram_id = ?`,
    [referredTelegramId]
  );
}

async function getReferralStats(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { total_referrals: 0, total_rewards: 0, pending_rewards: 0 };
  
  const stats = await getQuery(
    `SELECT 
       COUNT(*) as total_referrals,
       SUM(CASE WHEN rewarded = 1 THEN 1 ELSE 0 END) as total_rewards,
       SUM(CASE WHEN rewarded = 0 THEN 1 ELSE 0 END) as pending_rewards
     FROM referrals WHERE referrer_user_id = ?`,
    [user.id]
  );
  
  return {
    total_referrals: stats?.total_referrals || 0,
    total_rewards: stats?.total_rewards || 0,
    pending_rewards: stats?.pending_rewards || 0
  };
}

async function rewardReferral(referralId) {
  return await runQuery(
    'UPDATE referrals SET rewarded = 1, rewarded_at = CURRENT_TIMESTAMP WHERE id = ?',
    [referralId]
  );
}

// Mock functions for testing
async function getPremiumInviteLink() {
  return process.env.PREMIUM_CHANNEL_INVITE_LINK || 'https://t.me/+mock_premium_link';
}

async function getUserStats() {
  const stats = await getQuery(
    `SELECT 
       COUNT(*) as total_users,
       SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as new_users_24h,
       SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as new_users_7d
     FROM users`
  );
  return stats || { total_users: 0, new_users_24h: 0, new_users_7d: 0 };
}

async function getSubscriptionStats() {
  const stats = await getQuery(
    `SELECT 
       COUNT(*) as total_subscriptions,
       SUM(CASE WHEN status = 'active' AND expires_at > datetime('now') THEN 1 ELSE 0 END) as active_subscriptions,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_subscriptions,
       SUM(CASE WHEN status = 'active' AND expires_at <= datetime('now') THEN 1 ELSE 0 END) as expired_subscriptions
     FROM subscriptions`
  );
  return stats || { total_subscriptions: 0, active_subscriptions: 0, cancelled_subscriptions: 0, expired_subscriptions: 0 };
}

async function getRevenueStats() {
  return { total_revenue: 0, revenue_24h: 0, revenue_30d: 0 };
}

// Initialize database when module is loaded
let dbInitialized = false;

async function ensureDB() {
  if (!dbInitialized) {
    await initDB();
    dbInitialized = true;
  }
}

module.exports = {
  initDB: ensureDB,
  upsertUser,
  getUserByTelegramId,
  createSubscriptionFromPayment,
  getActiveSubscription,
  recordReferral,
  getReferralByUser,
  getReferralStats,
  rewardReferral,
  getPremiumInviteLink,
  getUserStats,
  getSubscriptionStats,
  getRevenueStats
};
