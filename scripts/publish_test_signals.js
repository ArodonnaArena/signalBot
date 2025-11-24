// One-off script to insert a test free and premium signal and publish them immediately
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { Telegraf } = require('telegraf');

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'signal_bot_db';
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN not set in .env');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const signalsCol = db.collection(process.env.SIGNALS_COLLECTION || 'ai_signals');
  const publishCol = db.collection('signal_publish_log');

  const bot = new Telegraf(process.env.BOT_TOKEN);

  const now = new Date();
  const future = new Date(Date.now() + 24 * 3600 * 1000);

  const premium = {
    is_premium: true,
    pair: 'BTC/USDT',
    signal_type: 'LONG',
    entry_price: '73,500',
    stop_loss: '71,200',
    take_profit: '76,800',
    confidence_level: 85,
    reasoning: 'Momentum breakout on higher timeframe',
    status: 'pending',
    generated_at: now,
    expires_at: future
  };

  const free = {
    is_premium: false,
    pair: 'ETH/USDT',
    signal_type: 'SHORT',
    entry_price: '3,420',
    stop_loss: '3,580',
    take_profit: '3,180',
    confidence_level: 78,
    reasoning: 'Range rejection at resistance',
    status: 'pending',
    generated_at: now,
    expires_at: future
  };

  const r1 = await signalsCol.insertOne(premium);
  premium._id = r1.insertedId;
  console.log('Inserted premium signal id', premium._id.toString());

  const r2 = await signalsCol.insertOne(free);
  free._id = r2.insertedId;
  console.log('Inserted free signal id', free._id.toString());

  async function canPublish(type) {
    const doc = await publishCol.findOne({ _id: type });
    if (!doc || !doc.last_published) return true;
    const last = new Date(doc.last_published);
    if (type === 'premium') return (Date.now() - last.getTime()) >= (24 * 3600 * 1000);
    return (Date.now() - last.getTime()) >= (7 * 24 * 3600 * 1000);
  }

  async function doPublish(sig) {
    const type = sig.is_premium ? 'premium' : 'free';
    if (!(await canPublish(type))) {
      console.log('Publish window not elapsed for', type, 'signal', sig._id.toString());
      return;
    }
    const chatId = sig.is_premium ? (process.env.PREMIUM_CHANNEL_ID) : (process.env.FREE_CHANNEL_ID || process.env.PREMIUM_CHANNEL_ID);
    if (!chatId) throw new Error('Channel env var not set');

    const text = `🔔 *TEST ${sig.is_premium ? 'PREMIUM' : 'FREE'} SIGNAL*\n*Pair:* ${sig.pair}\n*Direction:* ${sig.signal_type}\n*Entry:* ${sig.entry_price}\n*Stop:* ${sig.stop_loss}\n*TP:* ${sig.take_profit}\n\n_Not financial advice._`;

    const msg = await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    console.log('Published to', chatId, 'message id', msg.message_id);

    await signalsCol.updateOne({ _id: sig._id }, { $set: { status: 'active', sent_at: new Date(), last_telegram_message_id: msg.message_id }, $addToSet: { sent_channels: String(chatId) } });
    await publishCol.updateOne({ _id: type }, { $set: { last_published: new Date() } }, { upsert: true });
  }

  try {
    await doPublish(premium);
  } catch (e) { console.error('Failed to publish premium:', e && e.message ? e.message : e); }

  try {
    await doPublish(free);
  } catch (e) { console.error('Failed to publish free:', e && e.message ? e.message : e); }

  try { await client.close(); } catch (e) {}
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
