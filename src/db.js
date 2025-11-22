// db.js - runtime wrapper. Supports Mongo, SQLite or MySQL/Postgres-style SQL implementations.
require('dotenv').config();
const useMongo = process.env.USE_MONGO_DB && (process.env.USE_MONGO_DB === '1' || process.env.USE_MONGO_DB.toLowerCase() === 'true');
if (useMongo) {
  module.exports = require('./db-mongo');
} else {
const { Pool } = require('pg');

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err);
  process.exit(-1);
});

/**
 * Execute a database query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', { text, params, error });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<Object>} Database client
 */
async function getClient() {
  return await pool.connect();
}

// User management functions

/**
 * Insert or update user information
 * @param {Object} userInfo - Telegram user object
 * @returns {Promise<Object>} User record
 */
async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  
  const queryText = `
    INSERT INTO users (telegram_id, username, display_name, created_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      updated_at = NOW()
    RETURNING *;
  `;
  
  const res = await query(queryText, [id, username, display_name]);
  return res.rows[0];
}

/**
 * Get user by telegram ID
 * @param {number} telegramId - Telegram user ID
 * @returns {Promise<Object|null>} User record or null
 */
async function getUserByTelegramId(telegramId) {
  const queryText = 'SELECT * FROM users WHERE telegram_id = $1';
  const res = await query(queryText, [telegramId]);
  return res.rows[0] || null;
}

/**
 * Get user by internal ID
 * @param {number} userId - Internal user ID
 * @returns {Promise<Object|null>} User record or null
 */
async function getUserById(userId) {
  const queryText = 'SELECT * FROM users WHERE id = $1';
  const res = await query(queryText, [userId]);
  return res.rows[0] || null;
}

// Subscription management functions

/**
 * Create subscription from payment
 * @param {Object} userInfo - Telegram user object
 * @param {Object} payment - Telegram payment object
 * @returns {Promise<Object>} Subscription record
 */
async function createSubscriptionFromPayment(userInfo, payment) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Ensure user exists
    const userRes = await client.query(
      `INSERT INTO users (telegram_id, username, display_name, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name,
         updated_at = NOW()
       RETURNING id`,
      [userInfo.id, userInfo.username, [userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ')]
    );
    
    const userId = userRes.rows[0].id;
    
    // Parse payment payload to determine plan
    const payload = payment.invoice_payload;
    const isMonthly = payload.includes('monthly');
    const isYearly = payload.includes('yearly');
    
    let plan, expiresAt;
    const startedAt = new Date();
    
    if (isMonthly) {
      plan = 'monthly';
      expiresAt = new Date(startedAt);
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else if (isYearly) {
      plan = 'yearly';
      expiresAt = new Date(startedAt);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      throw new Error('Unknown subscription plan in payload');
    }
    
    // Create subscription
    const subscriptionRes = await client.query(
      `INSERT INTO subscriptions (user_id, plan, provider, provider_payment_id, started_at, expires_at, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [userId, plan, 'telegram', payment.telegram_payment_charge_id, startedAt, expiresAt, 'active']
    );
    
    await client.query('COMMIT');
    return subscriptionRes.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get active subscription for user
 * @param {number} telegramId - Telegram user ID
 * @returns {Promise<Object|null>} Active subscription or null
 */
async function getActiveSubscription(telegramId) {
  const queryText = `
    SELECT s.*, u.telegram_id, u.username, u.display_name
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE u.telegram_id = $1
      AND s.status = 'active'
      AND s.expires_at > NOW()
    ORDER BY s.expires_at DESC
    LIMIT 1
  `;
  
  const res = await query(queryText, [telegramId]);
  return res.rows[0] || null;
}

/**
 * Get all subscriptions for user
 * @param {number} telegramId - Telegram user ID
 * @returns {Promise<Array>} Array of subscriptions
 */
async function getUserSubscriptions(telegramId) {
  const queryText = `
    SELECT s.*
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE u.telegram_id = $1
    ORDER BY s.created_at DESC
  `;
  
  const res = await query(queryText, [telegramId]);
  return res.rows;
}

/**
 * Cancel subscription
 * @param {number} subscriptionId - Subscription ID
 * @returns {Promise<Object>} Updated subscription record
 */
async function cancelSubscription(subscriptionId) {
  const queryText = `
    UPDATE subscriptions
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  
  const res = await query(queryText, [subscriptionId]);
  return res.rows[0];
}

// Referral management functions

/**
 * Record a referral
 * @param {number} referredTelegramId - Referred user's Telegram ID
 * @param {string} referralCode - Referral code
 * @returns {Promise<Object|null>} Referral record or null if invalid code
 */
async function recordReferral(referredTelegramId, referralCode) {
  try {
    // Extract referrer ID from code (format: REF{userId}{random})
    const match = referralCode.match(/^REF(\d+)/);
    if (!match) {
      console.log('Invalid referral code format:', referralCode);
      return null;
    }
    
    const referrerTelegramId = parseInt(match[1]);
    
    // Get referrer's internal user ID
    const referrer = await getUserByTelegramId(referrerTelegramId);
    if (!referrer) {
      console.log('Referrer not found:', referrerTelegramId);
      return null;
    }
    
    // Check if referral already exists
    const existingRes = await query(
      'SELECT id FROM referrals WHERE referred_telegram_id = $1',
      [referredTelegramId]
    );
    
    if (existingRes.rows.length > 0) {
      console.log('Referral already exists for user:', referredTelegramId);
      return null;
    }
    
    // Create referral record
    const queryText = `
      INSERT INTO referrals (referrer_user_id, referred_telegram_id, code, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *
    `;
    
    const res = await query(queryText, [referrer.id, referredTelegramId, referralCode]);
    return res.rows[0];
  } catch (error) {
    console.error('Error recording referral:', error);
    return null;
  }
}

/**
 * Get referral by referred user
 * @param {number} referredTelegramId - Referred user's Telegram ID
 * @returns {Promise<Object|null>} Referral record or null
 */
async function getReferralByUser(referredTelegramId) {
  const queryText = `
    SELECT r.*, u.telegram_id as referrer_telegram_id, u.username as referrer_username
    FROM referrals r
    JOIN users u ON r.referrer_user_id = u.id
    WHERE r.referred_telegram_id = $1
  `;
  
  const res = await query(queryText, [referredTelegramId]);
  return res.rows[0] || null;
}

/**
 * Get referral statistics for user
 * @param {number} telegramId - Referrer's Telegram ID
 * @returns {Promise<Object>} Referral stats
 */
async function getReferralStats(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return { total_referrals: 0, total_rewards: 0, pending_rewards: 0 };
  }
  
  const queryText = `
    SELECT 
      COUNT(*) as total_referrals,
      COUNT(*) FILTER (WHERE rewarded = true) as total_rewards,
      COUNT(*) FILTER (WHERE rewarded = false) as pending_rewards
    FROM referrals
    WHERE referrer_user_id = $1
  `;
  
  const res = await query(queryText, [user.id]);
  const stats = res.rows[0];
  
  return {
    total_referrals: parseInt(stats.total_referrals) || 0,
    total_rewards: parseInt(stats.total_rewards) || 0,
    pending_rewards: parseInt(stats.pending_rewards) || 0
  };
}

/**
 * Mark referral as rewarded and extend referrer's subscription
 * @param {number} referralId - Referral ID
 * @returns {Promise<Object>} Updated referral record
 */
async function rewardReferral(referralId) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Mark referral as rewarded
    const referralRes = await client.query(
      'UPDATE referrals SET rewarded = true, rewarded_at = NOW() WHERE id = $1 RETURNING *',
      [referralId]
    );
    
    const referral = referralRes.rows[0];
    
    // Extend referrer's subscription by reward days
    const rewardDays = parseInt(process.env.REFERRAL_REWARD_DAYS) || 3;
    
    await client.query(
      `UPDATE subscriptions 
       SET expires_at = expires_at + INTERVAL '${rewardDays} days'
       WHERE user_id = $1 AND status = 'active'`,
      [referral.referrer_user_id]
    );
    
    await client.query('COMMIT');
    return referral;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Product management functions

/**
 * Get product by SKU
 * @param {string} sku - Product SKU
 * @returns {Promise<Object|null>} Product record or null
 */
async function getProductBySku(sku) {
  const queryText = 'SELECT * FROM products WHERE sku = $1';
  const res = await query(queryText, [sku]);
  return res.rows[0] || null;
}

/**
 * Create product purchase record
 * @param {number} telegramId - User's Telegram ID
 * @param {string} productSku - Product SKU
 * @param {string} providerPaymentId - Payment provider ID
 * @returns {Promise<Object>} Purchase record
 */
async function createProductPurchase(telegramId, productSku, providerPaymentId) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Get or create user
    const userRes = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (userRes.rows.length === 0) {
      throw new Error('User not found');
    }
    
    const userId = userRes.rows[0].id;
    
    // Get product
    const productRes = await client.query(
      'SELECT id FROM products WHERE sku = $1',
      [productSku]
    );
    
    if (productRes.rows.length === 0) {
      throw new Error('Product not found');
    }
    
    const productId = productRes.rows[0].id;
    
    // Create purchase record
    const purchaseRes = await client.query(
      `INSERT INTO purchases (user_id, product_id, provider_payment_id, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [userId, productId, providerPaymentId]
    );
    
    await client.query('COMMIT');
    return purchaseRes.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Admin functions

/**
 * Get user statistics
 * @returns {Promise<Object>} User statistics
 */
async function getUserStats() {
  const queryText = `
    SELECT 
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as new_users_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_users_7d
    FROM users
  `;
  
  const res = await query(queryText);
  return res.rows[0];
}

/**
 * Get subscription statistics
 * @returns {Promise<Object>} Subscription statistics
 */
async function getSubscriptionStats() {
  const queryText = `
    SELECT 
      COUNT(*) as total_subscriptions,
      COUNT(*) FILTER (WHERE status = 'active' AND expires_at > NOW()) as active_subscriptions,
      COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_subscriptions,
      COUNT(*) FILTER (WHERE status = 'active' AND expires_at <= NOW()) as expired_subscriptions,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as new_subscriptions_24h
    FROM subscriptions
  `;
  
  const res = await query(queryText);
  return res.rows[0];
}

/**
 * Get revenue statistics
 * @returns {Promise<Object>} Revenue statistics
 */
async function getRevenueStats() {
  const monthlyPrice = 25;
  const yearlyPrice = 250;
  
  const queryText = `
    SELECT 
      COUNT(*) FILTER (WHERE plan = 'monthly') * ${monthlyPrice} +
      COUNT(*) FILTER (WHERE plan = 'yearly') * ${yearlyPrice} as total_revenue,
      COUNT(*) FILTER (WHERE plan = 'monthly' AND created_at >= NOW() - INTERVAL '24 hours') * ${monthlyPrice} +
      COUNT(*) FILTER (WHERE plan = 'yearly' AND created_at >= NOW() - INTERVAL '24 hours') * ${yearlyPrice} as revenue_24h,
      COUNT(*) FILTER (WHERE plan = 'monthly' AND created_at >= NOW() - INTERVAL '30 days') * ${monthlyPrice} +
      COUNT(*) FILTER (WHERE plan = 'yearly' AND created_at >= NOW() - INTERVAL '30 days') * ${yearlyPrice} as revenue_30d
    FROM subscriptions
    WHERE status IN ('active', 'cancelled')
  `;
  
  const res = await query(queryText);
  return res.rows[0];
}

/**
 * Get premium invite link (placeholder - implement based on your setup)
 * @returns {Promise<string>} Premium channel invite link
 */
async function getPremiumInviteLink() {
  // This is a placeholder. In a real implementation, you might:
  // 1. Generate temporary invite links
  // 2. Rotate links periodically
  // 3. Store links in database
  return process.env.PREMIUM_CHANNEL_INVITE_LINK || 'https://t.me/+your_premium_channel';
}

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
  query,
  getClient,
  
  // User functions
  upsertUser,
  getUserByTelegramId,
  getUserById,
  
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
  
  // Product functions
  getProductBySku,
  createProductPurchase,
  
  // Admin functions
  getUserStats,
  getSubscriptionStats,
  getRevenueStats,
  getPremiumInviteLink
};
}
