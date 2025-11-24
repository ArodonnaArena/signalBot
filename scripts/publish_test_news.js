#!/usr/bin/env node
// scripts/publish_test_news.js
// One-off script to insert and publish a test news item to the premium channel.
// Usage: set your .env variables, then run: `node scripts/publish_test_news.js`

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { Telegraf } = require('telegraf');

(async () => {
  const MONGODB_URI = process.env.MONGODB_URI;
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const PREMIUM_CHANNEL_ID = process.env.PREMIUM_CHANNEL_ID;

  if (!MONGODB_URI || !BOT_TOKEN || !PREMIUM_CHANNEL_ID) {
    console.error('Missing required env vars: MONGODB_URI, BOT_TOKEN, PREMIUM_CHANNEL_ID');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  const bot = new Telegraf(BOT_TOKEN);

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || 'signal_bot_db');
    const newsCol = db.collection('news_updates');

    // Create a test news item
    const now = new Date();
    const testNews = {
      title: 'Bitcoin Hits New All-Time High',
      summary: 'Bitcoin breaks above $100k barrier as institutional adoption accelerates.',
      source: 'CryptoNews Wire',
      url: 'https://example.com/btc-ath',
      created_at: now,
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
      status: 'pending'
    };

    console.log('Inserting test news item...');
    const insertRes = await newsCol.insertOne(testNews);
    console.log(`Inserted news with _id: ${insertRes.insertedId}`);

    // Format and send the news to Telegram
    const lines = [];
    lines.push(`📰 *${escapeMarkdown(testNews.title)}`);
    if (testNews.summary) {
      lines.push(`${escapeMarkdown(testNews.summary)}`);
    }
    if (testNews.source) {
      lines.push('', `*Source:* ${escapeMarkdown(testNews.source)}`);
    }
    if (testNews.url) {
      lines.push(`[Read more](${testNews.url})`);
    }
    if (testNews.created_at) {
      try {
        const c = new Date(testNews.created_at).toLocaleString();
        lines.push('', `_${escapeMarkdown(c)}_`);
      } catch (e) {}
    }

    const text = lines.join('\n');

    console.log(`\nSending news to channel ${PREMIUM_CHANNEL_ID}...`);
    console.log('Message preview:');
    console.log('---');
    console.log(text);
    console.log('---\n');

    try {
      const msg = await bot.telegram.sendMessage(PREMIUM_CHANNEL_ID, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`✓ News sent successfully! Message ID: ${msg.message_id}`);

      // Update the news item to mark it as published
      await newsCol.updateOne(
        { _id: insertRes.insertedId },
        {
          $set: {
            status: 'published',
            published_at: new Date(),
            last_telegram_message_id: msg.message_id
          }
        }
      );
      console.log('✓ News item marked as published in database');

      // Update or create the publish_log entry for news
      const publishCol = db.collection('signal_publish_log');
      await publishCol.updateOne(
        { _id: 'news' },
        { $set: { last_published: new Date() } },
        { upsert: true }
      );
      console.log('✓ Updated signal_publish_log for news');
    } catch (err) {
      console.error('✗ Failed to send news to Telegram:', err && err.message ? err.message : err);
      // Mark as failed
      await newsCol.updateOne(
        { _id: insertRes.insertedId },
        { $set: { status: 'pending', failed_at: new Date() } }
      );
    }
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    try { await client.close(); } catch (e) {}
    process.exit(0);
  }
})();

function escapeMarkdown(text = '') {
  return String(text).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
}
