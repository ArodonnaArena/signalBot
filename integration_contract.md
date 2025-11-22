# Integration Contract: `signal_bot` ↔ `telegram-crypto-bot`

## 1. Purpose

This document defines the integration contract between:

- **Producer**: `signal_bot` (Python) – AI signal generation system.
- **Consumer**: `telegram-crypto-bot` (Node.js) – Telegram business bot.

Goal: allow the Telegram bot to automatically fetch AI-generated trading signals from MongoDB and distribute them to Telegram users/channels, while keeping payment/referral logic unchanged.

---

## 2. Systems Overview

### 2.1 `signal_bot`

- Generates crypto/forex trading signals using TA + ML.
- Stores signals and their lifecycle in **MongoDB Atlas**.
- Database: `signal_bot_db`.
- Primary collection: `ai_signals`.

`signal_bot` is the **source of truth** for:

- What signals exist.
- Signal prices (entry/stop/TP).
- Confidence and risk–reward metrics.
- Signal lifecycle status (`pending`, `active`, `hit_tp`, `hit_sl`, `expired`, etc.).

### 2.2 `telegram-crypto-bot`

- Handles:
  - Telegram bot commands and UI (`/start`, `/free`, `/subscribe`, `/help`, etc.).
  - Subscription and product sales via Telegram Payments.
  - Referral tracking and rewards.
  - Admin API (stats, users, subscriptions, broadcasts).
- Persists business data in **SQL** (MySQL/Postgres/SQLite depending on module used).

`telegram-crypto-bot` is the **source of truth** for:

- Users, subscriptions, referrals, and purchases.
- Who is premium vs free.
- Premium channel invite links and user access.

### 2.3 Integration Principle

- `telegram-crypto-bot` must treat MongoDB as **read‑mostly** for signals:
  - Read new signals from `ai_signals`.
  - Optionally update signal `status` and a few metadata fields (e.g. `sent_at`).
- All other aspects (payments, referrals) remain in the SQL DB and are untouched by `signal_bot`.

---

## 3. MongoDB Contract

### 3.1 Connection

**Environment variables (used by both projects, but especially the Telegram bot):**

```env
MONGODB_URI="mongodb+srv://arodonna_SignalBotDBUser:ENCODED_PASSWORD@signal-cluster.xlijjcr.mongodb.net/?appName=Signal-Cluster"
MONGODB_DB_NAME="signal_bot_db"
SIGNALS_COLLECTION="ai_signals"
MARKET_DATA_COLLECTION="market_data"   # optional, mostly for signal_bot
```

> `ENCODED_PASSWORD` must be URL‑encoded (e.g. `Fareeda@#2019` → `Fareeda%40%232019`).

**Node.js connection example (telegram-crypto-bot):**

```js
const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'signal_bot_db';

const mongoClient = new MongoClient(uri);
await mongoClient.connect();
const mongoDb = mongoClient.db(dbName);
const signalsCol = mongoDb.collection(process.env.SIGNALS_COLLECTION || 'ai_signals');
```

### 3.2 `ai_signals` Document Schema

`signal_bot` will write documents to `signal_bot_db.ai_signals` with (at least) the following shape:

```jsonc
{
  "_id": ObjectId,                // Mongo internal ID (do not depend on format)
  "id": Number,                   // numeric surrogate ID created by signal_bot
  "market_type": "crypto" | "forex",
  "signal_type": "LONG" | "SHORT" | "HOLD",
  "pair": "BTCUSDT",            // or forex pair like "EURUSD"

  "entry_price": Number,
  "stop_loss": Number,
  "take_profit": Number,

  "confidence_level": Number,    // 0–100
  "risk_reward_ratio": Number,
  "ai_model_version": String,    // e.g. "hybrid_v1.0"

  "technical_score": Number,
  "ml_score": Number,
  "sentiment_score": Number,     // typically -100..100 or 0..100 depending on config

  "market_conditions": Object,   // arbitrary JSON from validation pipeline
  "reasoning": String,           // human-readable explanation

  "is_premium": Boolean,         // default true
  "validation_warnings": [String],

  "expires_at": ISODate,
  "generated_at": ISODate,

  "status": String,              // lifecycle state
  // Allowed values (minimum set):
  //   "pending"  – newly created by signal_bot, not yet posted to Telegram
  //   "active"   – sent to Telegram, still open in the market
  //   "hit_tp"   – take profit reached (closed by signal_bot monitoring)
  //   "hit_sl"   – stop loss reached
  //   "expired"  – timed out without hitting TP/SL

  // Optional fields set/updated by telegram-crypto-bot:
  "sent_at": ISODate,            // when posted to Telegram by consumer
  "sent_channels": [String],     // list of Telegram chat IDs or channel IDs
  "last_telegram_message_id": Number // last message id if needed for edits
}
```

**Responsibilities:**

- `signal_bot`:
  - Creates documents with `status = "pending"` and all pricing/analysis fields.
  - Updates `status` to `hit_tp`, `hit_sl`, `expired` based on its monitoring.
- `telegram-crypto-bot`:
  - Reads documents.
  - May update `status` from `pending` → `active`/`sent` after posting.
  - May add `sent_at`, `sent_channels`, `last_telegram_message_id`.

---

## 4. Telegram Bot Responsibilities

### 4.1 High-Level Workflow

1. Connect to MongoDB Atlas using `MONGODB_URI` and `MONGODB_DB_NAME`.
2. Periodically (or on demand) **fetch new signals** that need to be posted.
3. Format each signal into a Telegram message.
4. Send to appropriate destination(s):
   - Primary: `PREMIUM_CHANNEL_ID` (Telegram private channel).
   - Optional: individual premium subscribers.
5. After successful send, update the signal document in MongoDB:
   - Set `status` to `"active"` (or `"sent"`, but `"active"` keeps consistency with lifecycle).
   - Set `sent_at` and append to `sent_channels`.

The bot must **never modify**:

- `entry_price`, `stop_loss`, `take_profit`.
- `confidence_level`, `risk_reward_ratio`, `technical_score`, `ml_score`, `sentiment_score`.

These are owned by `signal_bot`.

### 4.2 Fetching Broadcastable Signals

Definition of a **broadcastable** signal for Telegram:

- `status` == `"pending"`.
- `is_premium` == `true` (or field missing, default to premium).
- `expires_at` is in the **future**.

Query (Node.js):

```js
const { DateTime } = require('luxon'); // or use native Date

async function fetchPendingSignals(signalsCol, { limit = 20 } = {}) {
  const now = new Date();

  const cursor = signalsCol
    .find({
      status: 'pending',
      is_premium: { $ne: false },
      expires_at: { $gt: now },
    })
    .sort({ generated_at: 1 })  // oldest first
    .limit(limit);

  return cursor.toArray();
}
```

### 4.3 Message Formatting Contract

Minimum information that must be presented to users for each signal:

- Pair & market type.
- Direction (LONG/SHORT).
- Entry / Stop Loss / Take Profit.
- Confidence level.
- Risk–reward ratio.
- Brief reasoning and warnings.
- Disclaimer.

Example formatter (Telegram MarkdownV2 or HTML):

```js
function formatSignalMessage(sig) {
  const direction = sig.signal_type === 'LONG' ? 'BUY (LONG)' : 'SELL (SHORT)';
  const market = sig.market_type.toUpperCase();

  const baseLines = [
    `

🔔 *NEW ${market} SIGNAL*`,
    `*Pair:* ${sig.pair}`,
    `*Direction:* ${direction}`,
    `*Entry:* ${sig.entry_price}`,
    `*Stop Loss:* ${sig.stop_loss}`,
    `*Take Profit:* ${sig.take_profit}`,
    `*Confidence:* ${sig.confidence_level}%`,
    `*Risk–Reward:* ${sig.risk_reward_ratio.toFixed(2)} : 1`,
  ];

  if (sig.reasoning) {
    baseLines.push('', `*Reasoning:* ${sig.reasoning}`);
  }

  if (Array.isArray(sig.validation_warnings) && sig.validation_warnings.length > 0) {
    baseLines.push('', '*Warnings:*');
    for (const w of sig.validation_warnings) {
      baseLines.push(`• ${w}`);
    }
  }

  baseLines.push(
    '',
    '_Not financial advice. Trade at your own risk._'
  );

  return baseLines.join('\n');
}
```

The Telegram bot may adapt styling but **must** preserve the core numeric fields and include a disclaimer.

### 4.4 Destination Rules

By default, signals are sent to:

- `PREMIUM_CHANNEL_ID` (from Telegram bot `.env`).

Optionally, the bot can:

- DM each active subscriber (using its SQL DB to find active subscriptions).

Contract:

- At least one destination (premium channel) must be used.
- Destinations used must be recorded in the signal document's `sent_channels` array.

Example send logic:

```js
async function sendSignalToPremium(bot, signalsCol, sig) {
  const chatId = process.env.PREMIUM_CHANNEL_ID;
  const text = formatSignalMessage(sig);

  const message = await bot.telegram.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });

  const now = new Date();

  await signalsCol.updateOne(
    { id: sig.id },
    {
      $set: {
        status: 'active',
        sent_at: now,
        last_telegram_message_id: message.message_id,
      },
      $addToSet: { sent_channels: String(chatId) },
    }
  );
}
```

### 4.5 Error Handling

- If sending a signal to Telegram fails:
  - The bot should **not** update `status` to `active`.
  - The bot may log the error and retry later.
- If updating the Mongo document fails after sending:
  - The bot should log the failure but **must not** resend the signal blindly on restart.
  - Recommended: store a local log (e.g. SQL table `telegram_signal_logs`) if strict idempotence is required.

---

## 5. Scheduling & Execution Model

The Telegram bot must have a **signal consumer loop** that runs alongside existing payment/referral logic.

### 5.1 Scheduling Contract

- Polling interval: configurable, recommended every 1–5 minutes.
- Environment variable:

```env
SIGNAL_POLL_INTERVAL_MS=60000   # 60 seconds
```

### 5.2 Example Consumer Loop (Node.js)

```js
async function startSignalConsumer(bot, signalsCol) {
  const intervalMs = parseInt(process.env.SIGNAL_POLL_INTERVAL_MS || '60000', 10);

  async function tick() {
    try {
      const signals = await fetchPendingSignals(signalsCol, { limit: 10 });
      for (const sig of signals) {
        await sendSignalToPremium(bot, signalsCol, sig);
        // Optional: also DM premium users here using SQL DB
      }
    } catch (err) {
      console.error('[SignalConsumer] Error in tick:', err);
    } finally {
      setTimeout(tick, intervalMs);
    }
  }

  // Start loop
  tick();
}

// In src/bot.js (after bot initialization and before bot.launch):

const { MongoClient } = require('mongodb');

if (require.main === module) {
  (async () => {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const mongoDb = mongoClient.db(process.env.MONGODB_DB_NAME || 'signal_bot_db');
    const signalsCol = mongoDb.collection(process.env.SIGNALS_COLLECTION || 'ai_signals');

    await startSignalConsumer(bot, signalsCol);

    await bot.launch();
    console.log('Telegram bot + signal consumer started');
  })().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
  });
}
```

Contract:

- Consumer loop must be **idempotent** per signal: it should not re‑send signals whose `status` is already `active`/`hit_tp`/`hit_sl`/`expired`.
- Polling interval should not be less than 10 seconds to respect Mongo and Telegram rate limits.

---

## 6. Security & Permissions

### 6.1 Data Ownership

- **MongoDB (`signal_bot_db`):**
  - Owned by `signal_bot`.
  - Telegram bot has read access and limited write access only to:
    - `status` field transitions: `pending` → `active`.
    - `sent_at`, `sent_channels`, `last_telegram_message_id`.

- **SQL DB (MySQL/Postgres/SQLite in telegram-crypto-bot):**
  - Owned by `telegram-crypto-bot`.
  - `signal_bot` does not touch it.

### 6.2 Credentials

- MongoDB URI and SQL credentials must be stored only in `.env` or secret managers, never in source code or VCS.
- Admin HTTP API (`/admin/*`) continues using `ADMIN_TOKEN` as defined in `.env`.

### 6.3 Rate Limits

- Telegram bot must respect Telegram rate limits:
  - Avoid sending more than ~20 messages/second from the bot.
  - For large broadcasts, throttle or queue sends.

---

## 7. Testing Strategy

### 7.1 Local / Dev Testing

1. Start `signal_bot` and generate a small number of test signals:
   - Ensure they appear in MongoDB with `status="pending"`.
2. Start `telegram-crypto-bot` with the signal consumer loop enabled.
3. Verify:
   - Signals are fetched and posted to `PREMIUM_CHANNEL_ID`.
   - Corresponding documents in `ai_signals` are updated:
     - `status` becomes `"active"`.
     - `sent_at` is set.
     - `sent_channels` includes the premium channel ID.

### 7.2 Failure Scenarios

- **Mongo unavailable**:
  - Consumer loop should log error and retry; bot core (payments, commands) should keep running.
- **Telegram API error**:
  - Consumer logs and skips the problematic signal for this tick; it may retry on the next iteration.
- **Schema mismatch**:
  - If critical fields are missing (`entry_price`, `stop_loss`, `take_profit`), consumer must not send the signal and should log a warning.

---

## 8. Future Extensions

- Directly DM signals only to users with `active` subscriptions (by joining SQL `subscriptions` with Mongo signals).
- Store a `telegram_message_ids` array in `ai_signals` to support message edits (e.g. status updates when TP/SL hit).
- Add a small HTTP endpoint in `telegram-crypto-bot` to manually trigger a re‑send of a specific signal by its numeric `id`.

---

## 9. Summary

- `signal_bot` writes AI signals to MongoDB (`signal_bot_db.ai_signals`) and manages their trading lifecycle.
- `telegram-crypto-bot` reads `pending` premium signals from the same MongoDB, posts them to Telegram, and marks them `active`.
- User payments, subscriptions, and referrals remain in the Telegram bot's SQL database and are independent from the AI signal storage.
- This contract ensures both systems are loosely coupled but fully interoperable through a stable MongoDB schema and well-defined responsibilities.
