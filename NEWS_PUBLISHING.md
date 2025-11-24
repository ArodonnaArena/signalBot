# News Publishing Feature Documentation

## Overview

The signal consumer now supports automatic posting of news items from a dedicated `news_updates` MongoDB collection. This keeps your Telegram channels active with regular market updates alongside trading signals.

## Architecture

### Collections

**`news_updates`** — stores market news items for publishing:
```javascript
{
  _id: ObjectId,
  title: "Bitcoin Breaks All-Time High",
  summary: "BTC crosses $100k on institutional adoption surge",
  source: "CryptoNews Wire",
  url: "https://example.com/btc-ath",
  created_at: ISODate("2024-01-15T10:00:00Z"),
  expires_at: ISODate("2024-01-16T10:00:00Z"),
  status: "pending", // or "sending", "published", "deferred"
  claimed_at: ISODate(...),
  published_at: ISODate(...),
  last_telegram_message_id: 12345,
  failed_at: ISODate(...)
}
```

**`signal_publish_log`** — tracks last published time per content type:
```javascript
{
  _id: "news",  // tracks news publishing cadence
  last_published: ISODate("2024-01-15T10:30:00Z")
}
```

## How It Works

### Publishing Flow

1. **Consumer Tick** (`signalConsumer.js` background loop or `api/run-consumer.js` serverless endpoint)
2. **Check News Cadence** — Read `signal_publish_log` entry for `_id: 'news'`
3. **Calculate Interval** — Default 60 minutes (configurable via `NEWS_PUBLISH_INTERVAL_MINUTES` env var)
4. **If Ready**:
   - Query `news_updates` for documents with `status: 'pending'` and `expires_at > now`
   - Atomically claim the item (set `status: 'sending'`)
   - Format the news message with title, summary, source, URL, timestamp
   - Post to `PREMIUM_CHANNEL_ID`
   - Update document: `status: 'published'`, `published_at`, `last_telegram_message_id`
   - Update `signal_publish_log`: set new `last_published` time

### Atomic Claiming

To prevent duplicate posts when multiple consumers are running:
```javascript
const claimRes = await newsCol.findOneAndUpdate(
  { _id: item._id, status: { $in: ['pending', null] } },
  { $set: { status: 'sending', claimed_at: now } },
  { returnDocument: 'after' }
);
```

Only the consumer that successfully claims the item (atomically transitions to `'sending'`) proceeds with posting.

## Configuration

### Environment Variables

Add to your `.env` or Vercel settings:

```env
# Required: Telegram channel to post news to
PREMIUM_CHANNEL_ID=-1003392353417

# Optional: News publishing cadence (in minutes, default 60)
NEWS_PUBLISH_INTERVAL_MINUTES=60

# Optional: Use more frequent cadence for busy channels
# NEWS_PUBLISH_INTERVAL_MINUTES=30
```

### Initialization

The init script (`scripts/init-mongo-collections.js`) automatically seeds the `signal_publish_log` entry:
```javascript
{ _id: 'news', last_published: null }
```

If running manually, ensure this document exists.

## Usage

### Publishing News Manually

Use the test script to validate news posting:

```bash
# Insert a test news item and post it immediately
node scripts/publish_test_news.js
```

This script:
1. Creates a test news document in `news_updates`
2. Formats the message (title, summary, source, link, timestamp)
3. Posts to the configured premium channel
4. Marks the document as published
5. Updates the publish log

Example output:
```
Inserting test news item...
Inserted news with _id: ObjectId(...)

Sending news to channel -1003392353417...
Message preview:
---
📰 *Bitcoin Hits New All-Time High*
Bitcoin breaks above $100k barrier as institutional adoption accelerates.

*Source:* CryptoNews Wire
[Read more](https://example.com/btc-ath)

_Monday, January 15, 2024, 10:00:00 AM_
---

✓ News sent successfully! Message ID: 123456
✓ News item marked as published in database
✓ Updated signal_publish_log for news
```

### Inserting News via MongoDB

```javascript
const newsCol = db.collection('news_updates');

await newsCol.insertOne({
  title: "Fed Signals Crypto Regulation Framework",
  summary: "New regulatory guidelines expected in Q1 2024...",
  source: "Financial Times",
  url: "https://ft.com/crypto-regulation",
  created_at: new Date(),
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  status: "pending"
});
```

### Batch Insert from External API

Example: fetching news from an API and storing for eventual posting:

```javascript
const newsApi = await fetch('https://newsapi.example.com/crypto');
const newsData = await newsApi.json();

const docs = newsData.articles.map(article => ({
  title: article.title,
  summary: article.description,
  source: article.source,
  url: article.url,
  created_at: new Date(article.publishedAt),
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  status: 'pending'
}));

await newsCol.insertMany(docs);
```

## Message Format

News items are formatted as:

```
📰 *Title of News Story*
Brief summary text goes here with key details.

*Source:* Source Name
[Read more](https://link-to-full-article.com)

_Monday, January 15, 2024, 10:00:00 AM_
```

The format includes:
- **Emoji**: 📰 newspaper emoji
- **Title**: Bold, markdown-escaped
- **Summary**: Plain text summary (optional)
- **Source**: Attributed to provider (optional)
- **Link**: Clickable "Read more" link to full article (optional)
- **Timestamp**: Creation date formatted in local timezone

## Status Lifecycle

### News Document States

| Status | Meaning | Next State |
|--------|---------|-----------|
| `pending` | Ready to publish | `sending` |
| `sending` | Claimed by consumer, being sent | `published` or `pending` (if retried) |
| `published` | Successfully posted to Telegram | (final) |
| `deferred` | Not used for news (uses pending/published) | N/A |
| `failed` | Error during posting (optional tracking) | `pending` (for retry) |

### Examples

**Successful flow:**
```
pending → sending (atomic claim) → published (on success)
                ↓ (Telegram message sent, logged to DB)
```

**Failure with retry:**
```
pending → sending → pending (if error, status reverted)
              ↓
         (retried on next tick)
```

## Monitoring & Debugging

### Check Last News Publication Time

```javascript
const publishLog = await db.collection('signal_publish_log').findOne({ _id: 'news' });
console.log(publishLog.last_published); // null or ISO timestamp
```

### Query Pending News Items

```javascript
const pending = await db.collection('news_updates').find({ status: 'pending' }).toArray();
console.log(`${pending.length} news items waiting to publish`);
```

### Query Published News (Recent)

```javascript
const published = await db.collection('news_updates')
  .find({ status: 'published' })
  .sort({ published_at: -1 })
  .limit(10)
  .toArray();
published.forEach(item => {
  console.log(`${item.title} - Posted at ${item.published_at}`);
});
```

### Check Consumer Logs

If running as background process:
```bash
# In src/bot.js logs, look for:
# [SignalConsumer] News published and logged: ...
# or
# [SignalConsumer] Error in publishNewsIfReady: ...
```

If running as serverless:
```bash
# Check Vercel logs or CloudWatch for:
# run-consumer news error: ...
```

## Integration Points

### With Signal Publishing

Both signals and news are handled in the same tick:
1. **Process all pending signals** (limited to 20 per tick)
2. **Attempt to publish one news item** (if cadence allows)

This ensures news doesn't starve signal publishing and vice versa.

### With Rate Limiting

- **Signals**: Premium (1/24h), Free (1/7d)
- **News**: Configurable interval (default 60 min)

Publish log tracks these separately, allowing independent cadences.

### With Expiry

News items with `expires_at` in the past are ignored during polling. This prevents stale news from accidentally being published.

## Performance Considerations

### Database Indexes

Ensure the following indexes exist on `news_updates`:
```javascript
// Recommended indexes (add if not present):
db.collection('news_updates').createIndex({ status: 1, expires_at: 1 });
db.collection('news_updates').createIndex({ created_at: -1 });
```

### Query Efficiency

The consumer uses:
```javascript
db.collection('news_updates').findOne(
  { status: { $in: ['pending', null] }, expires_at: { $gt: now } },
  { sort: { created_at: -1 } }
);
```

This pulls the most recent pending news, sorted by creation date (newest first).

### Telegram Rate Limits

- Free/Business account: ~30 messages/second per chat
- News posting every 60 minutes should never hit rate limits

## Troubleshooting

### News not posting?

1. **Check interval:**
   ```javascript
   const publishLog = await db.collection('signal_publish_log').findOne({ _id: 'news' });
   if (publishLog?.last_published) {
     const elapsed = new Date() - publishLog.last_published;
     console.log(`Elapsed since last news post: ${elapsed / 1000 / 60} minutes`);
   }
   ```

2. **Check pending items:**
   ```javascript
   const count = await db.collection('news_updates')
     .countDocuments({ status: 'pending', expires_at: { $gt: new Date() } });
   console.log(`${count} news items ready to post`);
   ```

3. **Check channel ID:**
   ```javascript
   console.log(process.env.PREMIUM_CHANNEL_ID); // must be set
   ```

4. **Check consumer execution:**
   - For background: confirm `npm start` is running and logs show `[SignalConsumer]` messages
   - For serverless: check Vercel logs at `vercel.com/dashboard` → project → Logs

### News posting too frequently?

Increase `NEWS_PUBLISH_INTERVAL_MINUTES`:
```env
NEWS_PUBLISH_INTERVAL_MINUTES=120  # Publish every 2 hours instead
```

Then restart the process or wait for next function invocation.

### Duplicates?

Verify atomic claiming is working. If using multiple consumer instances:
- Ensure they all connect to the same MongoDB
- Only one should successfully claim (atomic `findOneAndUpdate`)
- Check logs for "someone else claimed" messages

## Future Enhancements

Potential improvements:
- [ ] News categorization (crypto, forex, macro, regulation)
- [ ] Routing to specific channels by category
- [ ] News deduplication (avoid posting the same story twice)
- [ ] User reactions tracking (emoji votes on usefulness)
- [ ] Edit old news if updated information arrives
- [ ] Archive news after expiry

