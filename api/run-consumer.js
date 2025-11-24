import { Telegraf } from 'telegraf';
import { MongoClient, ObjectId } from 'mongodb';

function escapeMarkdown(text = '') {
  // minimal escaping for Markdown
  return String(text).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
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

// Single-tick consumer endpoint for Vercel (or any serverless environment).
// Protect with ADMIN_TOKEN header: set `ADMIN_TOKEN` in env and call with header `x-admin-token: <token>`

export default async function handler(req, res) {
  try {
    // simple auth
    const token = req.headers['x-admin-token'] || req.query.token || '';
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) return res.status(500).json({ error: 'MONGODB_URI not configured' });

    const dbName = process.env.MONGODB_DB_NAME || 'signal_bot_db';
    const collName = process.env.SIGNALS_COLLECTION || 'ai_signals';
    const premiumChatId = process.env.PREMIUM_CHANNEL_ID;
    const freeChatId = process.env.FREE_CHANNEL_ID || process.env.PREMIUM_CHANNEL_ID;

    const bot = new Telegraf(process.env.BOT_TOKEN);

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(dbName);
    const signalsCol = db.collection(collName);
    const publishCol = db.collection('signal_publish_log');
    const newsCol = db.collection('news_updates');

    const now = new Date();

    // fetch a small batch of signals
    const pending = await signalsCol.find({ status: 'pending', is_premium: { $ne: false }, expires_at: { $gt: now } }).sort({ generated_at: 1 }).limit(20).toArray();

    const results = [];

    for (const sigRaw of pending) {
      // atomically claim the signal
      const claimFilter = { _id: sigRaw._id, status: 'pending' };
      const claimedAt = new Date();
      const claimRes = await signalsCol.findOneAndUpdate(claimFilter, { $set: { status: 'sending', claimed_at: claimedAt } }, { returnDocument: 'after' });
      if (!claimRes.value) continue; // someone else claimed
      const sig = claimRes.value;

      try {
        if (!sig.entry_price && !sig.entry) {
          results.push({ id: sig._id, status: 'skipped', reason: 'no entry' });
          continue;
        }

        const type = sig.is_premium ? 'premium' : 'free';
        const publishDoc = await publishCol.findOne({ _id: type });
        const last = publishDoc && publishDoc.last_published ? new Date(publishDoc.last_published) : null;

        let allowed = true;
        if (last) {
          if (type === 'premium') allowed = (now - last) >= (24 * 3600 * 1000);
          else allowed = (now - last) >= (7 * 24 * 3600 * 1000);
        }

        if (!allowed) {
          // defer only if we still have claimed status
          await signalsCol.updateOne({ _id: sig._id, status: 'sending' }, { $set: { status: 'deferred', deferred_at: now } });
          results.push({ id: sig._id, status: 'deferred', reason: 'publish window not elapsed' });
          continue;
        }

        const chatId = sig.is_premium ? premiumChatId : freeChatId;
        if (!chatId) {
          results.push({ id: sig._id, status: 'skipped', reason: 'no channel configured' });
          continue;
        }

        const market = (sig.market_type || '').toUpperCase() || 'MARKET';
        const direction = sig.signal_type === 'LONG' ? 'BUY (LONG)' : sig.signal_type === 'SHORT' ? 'SELL (SHORT)' : sig.signal_type || 'HOLD';

        const textLines = [];
        textLines.push(`🔔 *NEW ${escapeMarkdown(market)} SIGNAL*`);
        textLines.push(`*Pair:* ${escapeMarkdown(sig.pair || 'N/A')}`);
        textLines.push(`*Direction:* ${escapeMarkdown(direction)}`);
        textLines.push(`*Entry:* ${escapeMarkdown(String(sig.entry_price || sig.entry || 'N/A'))}`);
        textLines.push(`*Stop Loss:* ${escapeMarkdown(String(sig.stop_loss || sig.stop || 'N/A'))}`);
        textLines.push(`*Take Profit:* ${escapeMarkdown(String(sig.take_profit || sig.take || 'N/A'))}`);
        if (sig.confidence_level !== undefined) textLines.push(`*Confidence:* ${escapeMarkdown(String(sig.confidence_level))}%`);
        if (sig.risk_reward_ratio !== undefined) textLines.push(`*Risk–Reward:* ${escapeMarkdown(String(Number(sig.risk_reward_ratio).toFixed(2)))} : 1`);
        if (sig.reasoning) textLines.push('', `*Reasoning:* ${escapeMarkdown(sig.reasoning)}`);

        // Include generated/expires timestamps for transparency
        if (sig.generated_at) {
          try { textLines.push('', `*Generated:* ${escapeMarkdown(new Date(sig.generated_at).toLocaleString())}`); } catch(e){}
        }
        if (sig.expires_at) {
          try { textLines.push(`*Expires:* ${escapeMarkdown(new Date(sig.expires_at).toLocaleString())}`); } catch(e){}
        }

        textLines.push('', '_Not financial advice. Trade at your own risk._');

        const text = textLines.join('\n');

        const msg = await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });

        await signalsCol.updateOne({ _id: sig._id }, { $set: { status: 'active', sent_at: new Date(), last_telegram_message_id: msg.message_id }, $addToSet: { sent_channels: String(chatId) } });
        await publishCol.updateOne({ _id: type }, { $set: { last_published: new Date() } }, { upsert: true });

        results.push({ id: sig._id, status: 'sent', channel: String(chatId), message_id: msg.message_id });
      } catch (err) {
        console.error('run-consumer error for signal', sig._id, err && err.message ? err.message : err);
        results.push({ id: sig._id, status: 'error', error: err && err.message ? err.message : String(err) });
      }
    }

    // Also try to publish a news item if ready
    try {
      const newsIntervalMin = parseInt(process.env.NEWS_PUBLISH_INTERVAL_MINUTES || '60', 10);
      const newsPublishDoc = await publishCol.findOne({ _id: 'news' });
      const lastNewsPublish = newsPublishDoc && newsPublishDoc.last_published ? new Date(newsPublishDoc.last_published) : null;
      
      let newsAllowed = true;
      if (lastNewsPublish) {
        newsAllowed = (now - lastNewsPublish) >= (newsIntervalMin * 60 * 1000);
      }

      if (newsAllowed) {
        // Find an unpublished news item that hasn't expired
        const newsItem = await newsCol.findOne(
          { status: { $in: ['pending', null] }, expires_at: { $gt: now } },
          { sort: { created_at: -1 } }
        );

        if (newsItem) {
          // Atomically claim it
          const newsClaimRes = await newsCol.findOneAndUpdate(
            { _id: newsItem._id, status: { $in: ['pending', null] } },
            { $set: { status: 'sending', claimed_at: now } },
            { returnDocument: 'after' }
          );

          if (newsClaimRes.value) {
            try {
              const newsText = formatNewsMessage(newsClaimRes.value);
              const newsMsg = await bot.telegram.sendMessage(premiumChatId, newsText, { parse_mode: 'Markdown', disable_web_page_preview: true });
              
              await newsCol.updateOne(
                { _id: newsItem._id },
                { $set: { status: 'published', published_at: new Date(), last_telegram_message_id: newsMsg.message_id } }
              );
              await publishCol.updateOne(
                { _id: 'news' },
                { $set: { last_published: new Date() } },
                { upsert: true }
              );

              results.push({ id: newsItem._id, type: 'news', status: 'sent', channel: String(premiumChatId), message_id: newsMsg.message_id });
            } catch (err) {
              console.error('run-consumer error for news', newsItem._id, err && err.message ? err.message : err);
              // Mark as failed to send, revert status
              await newsCol.updateOne({ _id: newsItem._id, status: 'sending' }, { $set: { status: 'pending', failed_at: now } });
              results.push({ id: newsItem._id, type: 'news', status: 'error', error: err && err.message ? err.message : String(err) });
            }
          }
        }
      }
    } catch (err) {
      console.error('run-consumer news error:', err && err.message ? err.message : err);
    }

    try { await client.close(); } catch (e) {}

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error('run-consumer error:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'internal_error', message: error && error.message ? error.message : String(error) });
  }
}
