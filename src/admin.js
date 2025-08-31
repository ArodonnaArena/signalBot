const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const router = express.Router();

// Rate limiting for admin routes
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: 'Too many admin requests from this IP'
});

router.use(adminLimiter);

// Simple authentication middleware (enhance for production)
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminToken = process.env.ADMIN_TOKEN;
  
  if (!adminToken) {
    return res.status(500).json({ error: 'Admin token not configured' });
  }
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }
  
  const token = authHeader.slice(7);
  if (token !== adminToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  next();
};

// Apply authentication to all admin routes
router.use(authenticate);

// Dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    const userStats = await db.getUserStats();
    const subscriptionStats = await db.getSubscriptionStats();
    const revenueStats = await db.getRevenueStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      users: {
        total: parseInt(userStats.total_users) || 0,
        new_24h: parseInt(userStats.new_users_24h) || 0,
        new_7d: parseInt(userStats.new_users_7d) || 0
      },
      subscriptions: {
        total: parseInt(subscriptionStats.total_subscriptions) || 0,
        active: parseInt(subscriptionStats.active_subscriptions) || 0,
        cancelled: parseInt(subscriptionStats.cancelled_subscriptions) || 0,
        expired: parseInt(subscriptionStats.expired_subscriptions) || 0,
        new_24h: parseInt(subscriptionStats.new_subscriptions_24h) || 0
      },
      revenue: {
        total: parseFloat(revenueStats.total_revenue) || 0,
        last_24h: parseFloat(revenueStats.revenue_24h) || 0,
        last_30d: parseFloat(revenueStats.revenue_30d) || 0
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// User management
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;
    
    const queryText = `
      SELECT 
        u.id,
        u.telegram_id,
        u.username,
        u.display_name,
        u.created_at,
        s.status as subscription_status,
        s.expires_at as subscription_expires
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id 
        AND s.status = 'active' 
        AND s.expires_at > NOW()
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await db.query(queryText, [limit, offset]);
    
    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('Users list error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get specific user details
router.get('/users/:telegramId', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);
    
    if (!telegramId) {
      return res.status(400).json({ error: 'Invalid Telegram ID' });
    }
    
    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const subscriptions = await db.getUserSubscriptions(telegramId);
    const referralStats = await db.getReferralStats(telegramId);
    
    res.json({
      user,
      subscriptions,
      referral_stats: referralStats
    });
  } catch (error) {
    console.error('User details error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// Subscription management
router.get('/subscriptions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || 'active';
    
    let whereClause = '';
    let params = [limit, offset];
    
    if (status !== 'all') {
      whereClause = 'WHERE s.status = $3';
      params.push(status);
    }
    
    const queryText = `
      SELECT 
        s.*,
        u.telegram_id,
        u.username,
        u.display_name
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await db.query(queryText, params);
    
    res.json({
      subscriptions: result.rows,
      pagination: {
        page,
        limit,
        status
      }
    });
  } catch (error) {
    console.error('Subscriptions list error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Cancel subscription
router.post('/subscriptions/:id/cancel', async (req, res) => {
  try {
    const subscriptionId = parseInt(req.params.id);
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Invalid subscription ID' });
    }
    
    const subscription = await db.cancelSubscription(subscriptionId);
    
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    res.json({
      message: 'Subscription cancelled successfully',
      subscription
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Referral analytics
router.get('/referrals/stats', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        COUNT(*) as total_referrals,
        COUNT(*) FILTER (WHERE rewarded = true) as rewarded_referrals,
        COUNT(*) FILTER (WHERE rewarded = false) as pending_referrals,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as referrals_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as referrals_7d
      FROM referrals
    `;
    
    const result = await db.query(queryText);
    const stats = result.rows[0];
    
    res.json({
      total: parseInt(stats.total_referrals) || 0,
      rewarded: parseInt(stats.rewarded_referrals) || 0,
      pending: parseInt(stats.pending_referrals) || 0,
      last_24h: parseInt(stats.referrals_24h) || 0,
      last_7d: parseInt(stats.referrals_7d) || 0
    });
  } catch (error) {
    console.error('Referral stats error:', error);
    res.status(500).json({ error: 'Failed to fetch referral stats' });
  }
});

// Top referrers leaderboard
router.get('/referrals/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    
    const queryText = `
      SELECT 
        u.telegram_id,
        u.username,
        u.display_name,
        COUNT(r.id) as total_referrals,
        COUNT(r.id) FILTER (WHERE r.rewarded = true) as successful_referrals
      FROM users u
      JOIN referrals r ON u.id = r.referrer_user_id
      GROUP BY u.id, u.telegram_id, u.username, u.display_name
      ORDER BY total_referrals DESC, successful_referrals DESC
      LIMIT $1
    `;
    
    const result = await db.query(queryText, [limit]);
    
    const leaderboard = result.rows.map((row, index) => ({
      rank: index + 1,
      telegram_id: row.telegram_id,
      username: row.username,
      display_name: row.display_name || row.username || 'Anonymous',
      total_referrals: parseInt(row.total_referrals),
      successful_referrals: parseInt(row.successful_referrals)
    }));
    
    res.json({
      leaderboard,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Referral leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch referral leaderboard' });
  }
});

// Send broadcast message (use with caution)
router.post('/broadcast', async (req, res) => {
  try {
    const { message, target_group = 'all' } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    if (message.length > 4096) {
      return res.status(400).json({ error: 'Message too long (max 4096 characters)' });
    }
    
    let whereClause = '';
    let queryParams = [];
    
    // Define target groups
    switch (target_group) {
      case 'premium':
        whereClause = `
          WHERE u.id IN (
            SELECT DISTINCT s.user_id 
            FROM subscriptions s 
            WHERE s.status = 'active' AND s.expires_at > NOW()
          )
        `;
        break;
      case 'free':
        whereClause = `
          WHERE u.id NOT IN (
            SELECT DISTINCT s.user_id 
            FROM subscriptions s 
            WHERE s.status = 'active' AND s.expires_at > NOW()
          )
        `;
        break;
      default:
        // 'all' - no filter
        break;
    }
    
    const queryText = `
      SELECT telegram_id 
      FROM users u
      ${whereClause}
      ORDER BY created_at DESC
    `;
    
    const result = await db.query(queryText, queryParams);
    const telegramIds = result.rows.map(row => row.telegram_id);
    
    // Note: In a real implementation, you would queue these messages
    // and send them gradually to avoid hitting rate limits
    res.json({
      message: 'Broadcast queued successfully',
      target_count: telegramIds.length,
      target_group,
      preview: message.substring(0, 100) + (message.length > 100 ? '...' : '')
    });
    
    // Here you would implement the actual message sending logic
    // This is just a placeholder response
    console.log(`Broadcast queued for ${telegramIds.length} users in group: ${target_group}`);
    
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Failed to queue broadcast' });
  }
});

// Export user data (for GDPR compliance)
router.get('/export/user/:telegramId', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);
    
    if (!telegramId) {
      return res.status(400).json({ error: 'Invalid Telegram ID' });
    }
    
    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const subscriptions = await db.getUserSubscriptions(telegramId);
    const referralStats = await db.getReferralStats(telegramId);
    
    // Get referral records where user was referrer
    const referralsGiven = await db.query(
      `SELECT referred_telegram_id, code, rewarded, created_at 
       FROM referrals WHERE referrer_user_id = $1`,
      [user.id]
    );
    
    // Get referral record where user was referred
    const referralReceived = await db.getReferralByUser(telegramId);
    
    const exportData = {
      export_date: new Date().toISOString(),
      user_data: {
        telegram_id: user.telegram_id,
        username: user.username,
        display_name: user.display_name,
        created_at: user.created_at
      },
      subscriptions: subscriptions,
      referral_stats: referralStats,
      referrals_given: referralsGiven.rows,
      referral_received: referralReceived
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user_${telegramId}_data.json"`);
    res.json(exportData);
    
  } catch (error) {
    console.error('User export error:', error);
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

// Health check for admin panel
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    admin_panel: 'active'
  });
});

module.exports = router;
