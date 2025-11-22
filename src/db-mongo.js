require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'signal_bot_db';

if (!MONGODB_URI) {
  console.warn('[db-mongo] MONGODB_URI not set — Mongo app DB will fail until configured');
}

let client;
let db;

async function connect() {
  if (db) return db;
  client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  await client.connect();
  db = client.db(DB_NAME);
  // collections assumed already created by init script
  return db;
}

async function initDB() {
  await connect();
}

function nowISO() { return new Date(); }

async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  const db = await connect();
  const users = db.collection('app_users');
  const res = await users.findOneAndUpdate(
    { telegram_id: id },
    { $set: { username: username || null, display_name: display_name || null, updated_at: nowISO() }, $setOnInsert: { created_at: nowISO() } },
    { upsert: true, returnDocument: 'after' }
  );
  return res.value;
}

async function getUserByTelegramId(telegramId) {
  const db = await connect();
  return await db.collection('app_users').findOne({ telegram_id: telegramId });
}

async function createSubscriptionFromPayment(userInfo, payment) {
  const db = await connect();
  // ensure user
  await upsertUser(userInfo);
  const users = db.collection('app_users');
  const subs = db.collection('app_subscriptions');
  const user = await users.findOne({ telegram_id: userInfo.id });

  const payload = payment.invoice_payload || '';
  const isMonthly = payload.includes('monthly');
  const isYearly = payload.includes('yearly');
  const startedAt = nowISO();
  const expiresAt = new Date(startedAt);
  if (isMonthly) expiresAt.setMonth(expiresAt.getMonth() + 1);
  else if (isYearly) expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  else expiresAt.setMonth(expiresAt.getMonth() + 1);

  const doc = {
    user_telegram_id: userInfo.id,
    plan: isMonthly ? 'monthly' : 'yearly',
    provider: 'telegram',
    provider_payment_id: payment.telegram_payment_charge_id || null,
    started_at: startedAt,
    expires_at: expiresAt,
    status: 'active',
    created_at: nowISO(),
    updated_at: nowISO()
  };

  const r = await subs.insertOne(doc);
  doc._id = r.insertedId;
  return doc;
}

async function getActiveSubscription(telegramId) {
  const db = await connect();
  return await db.collection('app_subscriptions').findOne({ user_telegram_id: telegramId, status: 'active', expires_at: { $gt: new Date() } }, { sort: { expires_at: -1 } });
}

async function getUserSubscriptions(telegramId) {
  const db = await connect();
  return await db.collection('app_subscriptions').find({ user_telegram_id: telegramId }).sort({ created_at: -1 }).toArray();
}

async function cancelSubscription(subscriptionId) {
  const db = await connect();
  const col = db.collection('app_subscriptions');
  const filter = typeof subscriptionId === 'string' ? { _id: new ObjectId(subscriptionId) } : { _id: subscriptionId };
  const res = await col.findOneAndUpdate(filter, { $set: { status: 'cancelled', updated_at: nowISO() } }, { returnDocument: 'after' });
  return res.value;
}

async function recordReferral(referredTelegramId, referralCode) {
  try {
    const db = await connect();
    const match = (referralCode || '').match(/^REF(\d+)/);
    if (!match) return null;
    const referrerTelegramId = parseInt(match[1]);
    const referrer = await getUserByTelegramId(referrerTelegramId);
    if (!referrer) return null;

    const existing = await db.collection('app_referrals').findOne({ referred_telegram_id: referredTelegramId });
    if (existing) return null;

    const doc = {
      referrer_telegram_id: referrerTelegramId,
      referred_telegram_id: referredTelegramId,
      code: referralCode,
      rewarded: false,
      created_at: nowISO()
    };
    const r = await db.collection('app_referrals').insertOne(doc);
    doc._id = r.insertedId;
    return doc;
  } catch (err) {
    console.error('recordReferral error', err);
    return null;
  }
}

async function getReferralByUser(referredTelegramId) {
  const db = await connect();
  return await db.collection('app_referrals').findOne({ referred_telegram_id: referredTelegramId });
}

async function getReferralStats(telegramId) {
  const db = await connect();
  const total = await db.collection('app_referrals').countDocuments({ referrer_telegram_id: telegramId });
  const totalRewards = await db.collection('app_referrals').countDocuments({ referrer_telegram_id: telegramId, rewarded: true });
  const pending = await db.collection('app_referrals').countDocuments({ referrer_telegram_id: telegramId, rewarded: false });
  return { total_referrals: total, total_rewards: totalRewards, pending_rewards: pending };
}

async function rewardReferral(referralId) {
  const db = await connect();
  const filter = typeof referralId === 'string' ? { _id: new ObjectId(referralId) } : { _id: referralId };
  const r = await db.collection('app_referrals').findOneAndUpdate(filter, { $set: { rewarded: true, rewarded_at: nowISO() } }, { returnDocument: 'after' });
  // Optionally extend subscription - implement later if desired
  return r.value;
}

async function logSignalDeliveryFailure({ signalId = null, telegramMessageId = null, channelId = null, errorMessage = null, metadata = null } = {}) {
  const db = await connect();
  const doc = { signal_id: signalId ? String(signalId) : null, telegram_message_id: telegramMessageId || null, channel_id: channelId || null, error_message: errorMessage || null, metadata: metadata || null, created_at: nowISO() };
  await db.collection('telegram_signal_logs').insertOne(doc);
}

async function getPremiumInviteLink() {
  return process.env.PREMIUM_CHANNEL_INVITE_LINK || 'https://t.me/+mock_premium_link';
}

async function getUserStats() {
  const db = await connect();
  const total = await db.collection('app_users').countDocuments();
  const new24 = await db.collection('app_users').countDocuments({ created_at: { $gt: new Date(Date.now() - 24 * 3600 * 1000) } });
  const new7 = await db.collection('app_users').countDocuments({ created_at: { $gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
  return { total_users: total, new_users_24h: new24, new_users_7d: new7 };
}

async function getSubscriptionStats() {
  const db = await connect();
  const total = await db.collection('app_subscriptions').countDocuments();
  const active = await db.collection('app_subscriptions').countDocuments({ status: 'active', expires_at: { $gt: new Date() } });
  const cancelled = await db.collection('app_subscriptions').countDocuments({ status: 'cancelled' });
  return { total_subscriptions: total, active_subscriptions: active, cancelled_subscriptions: cancelled };
}

async function getRevenueStats() {
  // approximate: count plans and multiply by price
  const db = await connect();
  const monthly = await db.collection('app_subscriptions').countDocuments({ plan: 'monthly' });
  const yearly = await db.collection('app_subscriptions').countDocuments({ plan: 'yearly' });
  const monthlyPrice = 25; const yearlyPrice = 250;
  return { total_revenue: monthly * monthlyPrice + yearly * yearlyPrice, revenue_24h: 0, revenue_30d: 0 };
}

module.exports = {
  initDB,
  upsertUser,
  getUserByTelegramId,
  createSubscriptionFromPayment,
  getActiveSubscription,
  getUserSubscriptions,
  cancelSubscription,
  recordReferral,
  getReferralByUser,
  getReferralStats,
  rewardReferral,
  logSignalDeliveryFailure,
  getPremiumInviteLink,
  getUserStats,
  getSubscriptionStats,
  getRevenueStats
};
