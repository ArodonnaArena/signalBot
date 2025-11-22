const { MongoClient, ObjectId } = require('mongodb');
const db = require('./db');

function escapeMarkdown(text = '') {
  // minimal escaping for Markdown (keep simple)
  return String(text).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
}

function formatSignalMessage(sig) {
  const direction = sig.signal_type === 'LONG' ? 'BUY (LONG)' : sig.signal_type === 'SHORT' ? 'SELL (SHORT)' : sig.signal_type || 'HOLD';
  const market = (sig.market_type || '').toUpperCase();

  const lines = [];
  lines.push(`🔔 *NEW ${escapeMarkdown(market)} SIGNAL*`);
  lines.push(`*Pair:* ${escapeMarkdown(sig.pair || 'N/A')}`);
  lines.push(`*Direction:* ${escapeMarkdown(direction)}`);
  lines.push(`*Entry:* ${escapeMarkdown(String(sig.entry_price || sig.entry || 'N/A'))}`);
  lines.push(`*Stop Loss:* ${escapeMarkdown(String(sig.stop_loss || sig.stop || 'N/A'))}`);
  lines.push(`*Take Profit:* ${escapeMarkdown(String(sig.take_profit || sig.take || 'N/A'))}`);
  if (sig.confidence_level !== undefined) lines.push(`*Confidence:* ${escapeMarkdown(String(sig.confidence_level))}%`);
  if (sig.risk_reward_ratio !== undefined) lines.push(`*Risk–Reward:* ${escapeMarkdown(String(Number(sig.risk_reward_ratio).toFixed(2)))} : 1`);

  if (sig.reasoning) {
    lines.push('', `*Reasoning:* ${escapeMarkdown(sig.reasoning)}`);
  }

  if (Array.isArray(sig.validation_warnings) && sig.validation_warnings.length > 0) {
    lines.push('', '*Warnings:*');
    for (const w of sig.validation_warnings) lines.push(`• ${escapeMarkdown(w)}`);
  }

  lines.push('', '_Not financial advice. Trade at your own risk._');

  return lines.join('\n');
}

async function fetchPendingSignals(signalsCol, { limit = 10 } = {}) {
  const now = new Date();
  const cursor = signalsCol.find({
    status: 'pending',
    is_premium: { $ne: false },
    expires_at: { $gt: now }
  }).sort({ generated_at: 1 }).limit(limit);

  return cursor.toArray();
}

async function updateSignalDocumentWithRetry(signalsCol, filter, update, maxRetries = 3) {
  let attempt = 0;
  let backoff = 1000;
  while (attempt < maxRetries) {
    try {
      await signalsCol.updateOne(filter, update);
      return true;
    } catch (err) {
      attempt += 1;
      console.error(`[SignalConsumer] Mongo update attempt ${attempt} failed:`, err && err.message ? err.message : err);
      if (attempt >= maxRetries) throw err;
      await new Promise((res) => setTimeout(res, backoff));
      backoff *= 2;
    }
  }
}

// In-memory cache to avoid re-sending the same signal when Mongo updates repeatedly fail
const failedUpdateCache = new Set();

async function sendSignalToPremium(bot, signalsCol, sig) {
  const chatId = process.env.PREMIUM_CHANNEL_ID;
  if (!chatId) throw new Error('PREMIUM_CHANNEL_ID not set');

  const text = formatSignalMessage(sig);

  const message = await bot.telegram.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });

  const now = new Date();

  const filter = {};
  if (sig._id) filter._id = typeof sig._id === 'string' ? new ObjectId(sig._id) : sig._id;
  else if (sig.id !== undefined) filter.id = sig.id;
  else throw new Error('Signal has no _id or id');

  try {
    await updateSignalDocumentWithRetry(signalsCol, filter, {
      $set: {
        status: 'active',
        sent_at: now,
        last_telegram_message_id: message.message_id
      },
      $addToSet: { sent_channels: String(chatId) }
    }, 3);
  } catch (err) {
    // If Mongo update ultimately fails, log to SQL for manual reconciliation and avoid re-sending during this process lifetime
    const sigId = sig.id !== undefined ? sig.id : (sig._id ? String(sig._id) : null);
    failedUpdateCache.add(sigId);
    console.error('[SignalConsumer] Failed to update Mongo after retries for signal', sigId, err);
    try {
      await db.logSignalDeliveryFailure({
        signalId: sigId,
        telegramMessageId: message.message_id,
        channelId: chatId,
        errorMessage: err && err.message ? err.message : String(err),
        metadata: { signal: sig }
      });
    } catch (logErr) {
      console.error('[SignalConsumer] Failed to log delivery failure to SQL:', logErr);
    }
  }
}

async function startSignalConsumer(bot) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[SignalConsumer] MONGODB_URI not set — signal consumer disabled');
    return;
  }

  const dbName = process.env.MONGODB_DB_NAME || 'signal_bot_db';
  const collName = process.env.SIGNALS_COLLECTION || 'ai_signals';
  const intervalMs = parseInt(process.env.SIGNAL_POLL_INTERVAL_MS || '60000', 10);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const signalsCol = db.collection(collName);

  console.log('[SignalConsumer] Connected to MongoDB, listening for pending signals');

  let running = true;

  async function tick() {
    if (!running) return;
    try {
      const signals = await fetchPendingSignals(signalsCol, { limit: 10 });
      for (const sig of signals) {
        try {
          // basic validation
          if (!sig.entry_price && !sig.entry) {
            console.warn('[SignalConsumer] Skipping signal without entry:', sig.id || sig._id);
            continue;
          }

          await sendSignalToPremium(bot, signalsCol, sig);
          console.log('[SignalConsumer] Sent signal', sig.id || sig._id);
        } catch (err) {
          console.error('[SignalConsumer] Error sending signal', sig.id || sig._id, err);
        }
      }
    } catch (err) {
      console.error('[SignalConsumer] Tick error:', err);
    } finally {
      setTimeout(tick, Math.max(10000, intervalMs));
    }
  }

  // graceful stop
  process.once('SIGINT', async () => {
    running = false;
    try { await client.close(); } catch (e) {}
    console.log('[SignalConsumer] Closed MongoDB connection');
  });

  tick();
}

module.exports = { startSignalConsumer };
