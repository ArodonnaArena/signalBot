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

  // Include generation and expiry timestamps to help traceability
  if (sig.generated_at) {
    try {
      const g = new Date(sig.generated_at).toLocaleString();
      lines.push('', `*Generated:* ${escapeMarkdown(g)}`);
    } catch (e) {}
  }
  if (sig.expires_at) {
    try {
      const x = new Date(sig.expires_at).toLocaleString();
      lines.push(`*Expires:* ${escapeMarkdown(x)}`);
    } catch (e) {}
  }

  if (Array.isArray(sig.validation_warnings) && sig.validation_warnings.length > 0) {
    lines.push('', '*Warnings:*');
    for (const w of sig.validation_warnings) lines.push(`• ${escapeMarkdown(w)}`);
  }

  lines.push('', '_Not financial advice. Trade at your own risk._');

  return lines.join('\n');
}

function formatNewsMessage(item) {
  // Format a news item for Telegram posting
  const lines = [];
  lines.push(`📰 *${escapeMarkdown(item.title || 'News Update')}`);
  if (item.summary) {
    lines.push(`${escapeMarkdown(item.summary)}`);
  }
  if (item.source || item.provider) {
    lines.push('', `*Source:* ${escapeMarkdown(item.source || item.provider)}`);
  }
  if (item.url) {
    lines.push(`[Read more](${escapeMarkdown(item.url)})`);
  }
  if (item.created_at) {
    try {
      const c = new Date(item.created_at).toLocaleString();
      lines.push('', `_${escapeMarkdown(c)}_`);
    } catch (e) {}
  }
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

async function getPublishLog(col, type) {
  const doc = await col.findOne({ _id: type });
  return doc ? doc.last_published : null;
}

async function setPublishLog(col, type, when) {
  await col.updateOne({ _id: type }, { $set: { last_published: when } }, { upsert: true });
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
  // decide destination channel based on whether signal is premium
  const premiumChatId = process.env.PREMIUM_CHANNEL_ID;
  const freeChatId = process.env.FREE_CHANNEL_ID || process.env.PREMIUM_CHANNEL_ID;
  const chatId = sig.is_premium ? premiumChatId : freeChatId;
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
    // Update publish log for type
    try {
      const publishCol = signalsCol.db.collection('signal_publish_log');
      const type = sig.is_premium ? 'premium' : 'free';
      await setPublishLog(publishCol, type, now);
    } catch (e) {
      console.error('[SignalConsumer] Failed to update publish_log:', e && e.message ? e.message : e);
    }
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

  async function sendNewsToPremium(newsItem) {
    // Post a news item to the premium channel
    try {
      const channelId = process.env.PREMIUM_CHANNEL_ID;
      if (!channelId) {
        console.warn('[SignalConsumer] PREMIUM_CHANNEL_ID not set, skipping news');
        return;
      }
      const text = formatNewsMessage(newsItem);
      await bot.telegram.sendMessage(channelId, text, { parse_mode: 'Markdown' });
      console.log('[SignalConsumer] Posted news to premium channel:', newsItem._id || newsItem.id);
    } catch (err) {
      console.error('[SignalConsumer] Failed to send news:', err);
      throw err;
    }
  }

  async function publishNewsIfReady(newsCol, publishCol) {
    // Check if we should publish a news item
    try {
      const newsIntervalMin = parseInt(process.env.NEWS_PUBLISH_INTERVAL_MINUTES || '60', 10);
      const now = new Date();
      const last = await getPublishLog(publishCol, 'news');
      let allowed = true;
      if (last) {
        const lastDate = new Date(last);
        allowed = (now - lastDate) >= (newsIntervalMin * 60 * 1000);
      }

      if (!allowed) {
        return; // too soon
      }

      // Find an unpublished news item
      const newsItem = await newsCol.findOne({ status: { $in: ['pending', null] }, expires_at: { $gt: now } }, { sort: { created_at: -1 } });
      if (!newsItem) {
        return; // no news available
      }

      // Atomically claim it
      const claimRes = await newsCol.findOneAndUpdate(
        { _id: newsItem._id, status: { $in: ['pending', null] } },
        { $set: { status: 'sending', claimed_at: now } },
        { returnDocument: 'after' }
      );
      if (!claimRes.value) return; // someone else claimed it

      try {
        await sendNewsToPremium(claimRes.value);
        // Mark as published
        await newsCol.updateOne({ _id: newsItem._id }, { $set: { status: 'published', published_at: now } });
        // Update publish log
        await publishCol.updateOne({ _id: 'news' }, { $set: { last_published: now } }, { upsert: true });
        console.log('[SignalConsumer] News published and logged:', newsItem._id);
      } catch (err) {
        // Mark as failed to send, revert status
        await newsCol.updateOne({ _id: newsItem._id, status: 'sending' }, { $set: { status: 'pending', failed_at: now } });
        throw err;
      }
    } catch (err) {
      console.error('[SignalConsumer] Error in publishNewsIfReady:', err);
    }
  }

  async function tick() {
    if (!running) return;
    try {
      const signals = await fetchPendingSignals(signalsCol, { limit: 10 });
      const publishCol = db.collection('signal_publish_log');
      const newsCol = db.collection('news_updates');
      const now = new Date();
      for (const sigRaw of signals) {
        // Attempt to atomically claim the signal to avoid races with other runners
        const now = new Date();
        const claimFilter = { _id: sigRaw._id, status: 'pending' };
        const claimUpdate = { $set: { status: 'sending', claimed_at: now } };
        const claimRes = await signalsCol.findOneAndUpdate(claimFilter, claimUpdate, { returnDocument: 'after' });
        if (!claimRes.value) {
          // someone else claimed or status changed
          continue;
        }
        const sig = claimRes.value;
        try {
          // basic validation
          if (!sig.entry_price && !sig.entry) {
            console.warn('[SignalConsumer] Skipping signal without entry:', sig.id || sig._id);
            continue;
          }

          // Enforce publish windows
          const type = sig.is_premium ? 'premium' : 'free';
          const last = await getPublishLog(publishCol, type);
          let allowed = true;
          if (last) {
            const lastDate = new Date(last);
            if (type === 'premium') {
              // allow once per 24 hours
              allowed = (now - lastDate) >= (24 * 3600 * 1000);
            } else {
              // free: allow once per 7 days
              allowed = (now - lastDate) >= (7 * 24 * 3600 * 1000);
            }
          }

          if (!allowed) {
            console.log(`[SignalConsumer] Deferring ${type} signal ${sig.id || sig._id} — publish window not yet elapsed`);
            // mark as deferred so it can be re-evaluated later
            try {
              await signalsCol.updateOne({ _id: sig._id, status: 'sending' }, { $set: { status: 'deferred', deferred_at: now } });
            } catch (e) {
              console.error('[SignalConsumer] Failed to mark deferred:', e && e.message ? e.message : e);
            }
            continue;
          }

          await sendSignalToPremium(bot, signalsCol, sig);
          console.log('[SignalConsumer] Sent signal', sig.id || sig._id);
        } catch (err) {
          console.error('[SignalConsumer] Error sending signal', sig.id || sig._id, err);
        }
      }

      // Also try to publish a news item if ready
      await publishNewsIfReady(newsCol, publishCol);
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
