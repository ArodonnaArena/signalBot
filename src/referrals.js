const crypto = require('crypto');

/**
 * Generate a referral code for a user
 * @param {number} userId - User's Telegram ID
 * @returns {string} Referral code
 */
function generateReferralCode(userId) {
  // Generate a random suffix to make codes unique and harder to guess
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `REF${userId}${randomSuffix}`;
}

/**
 * Generate a referral link
 * @param {string} referralCode - Referral code
 * @returns {string} Referral link
 */
function generateReferralLink(referralCode) {
  const botUsername = process.env.BOT_USERNAME || 'YourBot';
  return `https://t.me/${botUsername}?start=${referralCode}`;
}

/**
 * Parse referral code to extract user ID
 * @param {string} referralCode - Referral code
 * @returns {number|null} User ID or null if invalid
 */
function parseReferralCode(referralCode) {
  try {
    const match = referralCode.match(/^REF(\d+)[A-F0-9]{6}$/);
    if (match) {
      return parseInt(match[1]);
    }
    return null;
  } catch (error) {
    console.error('Error parsing referral code:', error);
    return null;
  }
}

/**
 * Validate referral code format
 * @param {string} referralCode - Referral code
 * @returns {boolean} Whether code is valid format
 */
function isValidReferralCode(referralCode) {
  return /^REF\d+[A-F0-9]{6}$/.test(referralCode);
}

/**
 * Generate shareable referral message
 * @param {string} referralLink - Referral link
 * @param {string} referrerName - Referrer's name
 * @returns {string} Shareable message
 */
function generateReferralMessage(referralLink, referrerName = 'A friend') {
  return `🚀 ${referrerName} invited you to join CryptoSignals Bot!\n\n` +
         `Get premium crypto trading signals and we both earn 3 free days when you subscribe.\n\n` +
         `Join here: ${referralLink}\n\n` +
         `💎 Premium benefits:\n` +
         `• 3-5 high-quality signals per week\n` +
         `• Private premium channel access\n` +
         `• Educational content & analysis\n` +
         `• Risk management guidance\n\n` +
         `Start with a free sample signal! 📈`;
}

/**
 * Create referral tracking data for analytics
 * @param {string} referralCode - Referral code
 * @param {string} source - Source of the referral (telegram, whatsapp, etc.)
 * @returns {Object} Tracking data
 */
function createReferralTrackingData(referralCode, source = 'telegram') {
  return {
    referral_code: referralCode,
    source: source,
    timestamp: new Date().toISOString(),
    utm_source: 'referral',
    utm_medium: source,
    utm_campaign: 'user_referral',
    utm_content: referralCode
  };
}

/**
 * Generate referral statistics summary
 * @param {Object} stats - Raw stats from database
 * @returns {string} Formatted stats message
 */
function formatReferralStats(stats) {
  const { total_referrals, total_rewards, pending_rewards } = stats;
  
  return `📊 **Your Referral Stats**\n\n` +
         `👥 Total Referrals: ${total_referrals}\n` +
         `💰 Rewards Earned: ${total_rewards} (${total_rewards * 3} days)\n` +
         `⏳ Pending Rewards: ${pending_rewards}\n\n` +
         `Keep sharing to earn more free days! 🎯`;
}

/**
 * Calculate referral reward value
 * @param {number} rewardDays - Number of reward days
 * @param {number} monthlyPrice - Monthly subscription price
 * @returns {Object} Reward value breakdown
 */
function calculateReferralRewardValue(rewardDays = 3, monthlyPrice = 25) {
  const dailyValue = monthlyPrice / 30;
  const totalValue = dailyValue * rewardDays;
  
  return {
    days: rewardDays,
    daily_value: parseFloat(dailyValue.toFixed(2)),
    total_value: parseFloat(totalValue.toFixed(2)),
    monthly_price: monthlyPrice
  };
}

/**
 * Generate referral campaign data for specific promotions
 * @param {string} campaignName - Campaign identifier
 * @param {Object} options - Campaign options
 * @returns {Object} Campaign data
 */
function generateReferralCampaign(campaignName, options = {}) {
  const {
    bonus_days = 3,
    minimum_referrals = 1,
    expiry_date = null,
    special_message = null
  } = options;
  
  return {
    campaign_name: campaignName,
    bonus_days,
    minimum_referrals,
    expiry_date,
    special_message,
    created_at: new Date().toISOString()
  };
}

/**
 * Create social media sharing links for referrals
 * @param {string} referralLink - Referral link
 * @param {string} message - Sharing message
 * @returns {Object} Social media sharing links
 */
function createSocialSharingLinks(referralLink, message) {
  const encodedMessage = encodeURIComponent(message);
  const encodedLink = encodeURIComponent(referralLink);
  
  return {
    telegram: `https://t.me/share/url?url=${encodedLink}&text=${encodedMessage}`,
    whatsapp: `https://wa.me/?text=${encodedMessage}%20${encodedLink}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedMessage}&url=${encodedLink}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}&quote=${encodedMessage}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedLink}&summary=${encodedMessage}`,
    email: `mailto:?subject=Join%20CryptoSignals%20Bot&body=${encodedMessage}%20${encodedLink}`
  };
}

/**
 * Validate referral eligibility
 * @param {number} referrerTelegramId - Referrer's Telegram ID
 * @param {number} referredTelegramId - Referred user's Telegram ID
 * @returns {Object} Validation result
 */
function validateReferralEligibility(referrerTelegramId, referredTelegramId) {
  // Users cannot refer themselves
  if (referrerTelegramId === referredTelegramId) {
    return {
      valid: false,
      reason: 'Users cannot refer themselves'
    };
  }
  
  // Basic validation passed
  return {
    valid: true,
    reason: null
  };
}

/**
 * Generate referral leaderboard entry
 * @param {Object} userStats - User's referral statistics
 * @param {number} rank - User's rank in leaderboard
 * @returns {Object} Leaderboard entry
 */
function generateLeaderboardEntry(userStats, rank) {
  const { telegram_id, username, display_name, total_referrals, total_rewards } = userStats;
  
  return {
    rank,
    telegram_id,
    username,
    display_name: display_name || username || 'Anonymous',
    total_referrals,
    total_rewards,
    total_reward_days: total_rewards * 3,
    points: total_referrals * 10 + total_rewards * 5 // Custom point system
  };
}

module.exports = {
  generateReferralCode,
  generateReferralLink,
  parseReferralCode,
  isValidReferralCode,
  generateReferralMessage,
  createReferralTrackingData,
  formatReferralStats,
  calculateReferralRewardValue,
  generateReferralCampaign,
  createSocialSharingLinks,
  validateReferralEligibility,
  generateLeaderboardEntry
};
