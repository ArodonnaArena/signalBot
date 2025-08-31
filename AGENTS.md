# AGENTS.md — Telegram Crypto/Trading Learning Bot

> Detailed agent-style guide for building a Telegram bot that sells trading signals and learning products (paid subscription + one-off product), handles payments, referral tracking, and gated premium access.

---

## Table of contents

1. Overview & goals
2. Required accounts & prereqs
3. System architecture (components)
4. Data model
5. Detailed implementation (Node.js + Telegraf example)

   * Project structure
   * Key modules
   * Payment flow (sendInvoice, pre-checkout, confirm)
   * Referral tracking
   * Gating users into premium chat
6. InviteMember alternative (no-code / managed)
7. Deployment & hosting
8. Security, privacy & compliance
9. Testing, monitoring & KPIs
10. Sample messages, copy & partner templates
11. Troubleshooting & common gotchas
12. 30-day execution checklist

---

## 1. Overview & goals

Build a minimal, trustworthy Telegram bot product that:

* Accepts payments for a subscription (monthly) and one-off digital products.
* Delivers free sample content to convert new users.
* Sends 3–5 high-quality signals / lessons per week to premium subscribers.
* Tracks referrals and issues rewards (credits / free days).
* Automates gating (add paid users to a private channel/group).

Primary business objective: reach $1,000 in revenue in the first 30 days via subscriptions, ebook sales, and referral-driven conversions.

---

## 2. Required accounts & prereqs

* Telegram account and **bot** created with BotFather (you'll get a bot token).
* Payment provider: Stripe is commonly used for Telegram Bot Payments, but you can also use platforms like InviteMember (hosted) which integrate payments and membership logic.
* Hosting: small VPS (DigitalOcean), Cloud Run, or Heroku-like service for webhooks.
* Database: PostgreSQL (recommended) or SQLite for quick tests.
* Domain + HTTPS for webhook (if using webhooks).
* Development environment: Node.js (LTS) + npm/yarn.

Tools & libs used in this guide (examples):

* `telegraf` (Node.js) — Telegram library.
* `express` / `fastify` — for webhooks & simple admin endpoints.
* `pg` or `knex` — database access.

---

## 3. System architecture (components)

High-level components:

1. **Telegram Bot** (Telegraf-based): handles commands, sends invoices, receives updates.
2. **Payments Processor** (Telegram Payments routed via Stripe or InviteMember): handles card payments and receipts.
3. **Backend server**: webhook listener, membership logic, referral tracking, database.
4. **Premium Channel** (private Telegram channel or group): content delivery hub.
5. **Landing page**: single-page marketing + deep link to bot.
6. **Admin Dashboard (optional)**: manual control, user lookup, refunds.

Sequence for a subscription purchase (simplified):

1. User opens bot and requests `/subscribe`.
2. Bot creates and sends an invoice (sendInvoice) using the provider token.
3. User completes payment; Telegram sends pre-checkout and successful payment updates to the bot.
4. Bot verifies and grants access (adds user to private channel or sends invite link).
5. Bot records subscription, expiry, and referral credit (if any) in DB.

---

## 4. Data model (suggested)

Use a relational schema. Minimal tables:

```sql
-- users
users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  email TEXT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- subscriptions
subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  plan TEXT, -- e.g., monthly, yearly
  provider TEXT, -- telegram, invitemember
  provider_payment_id TEXT,
  started_at TIMESTAMP,
  expires_at TIMESTAMP,
  status TEXT, -- active, cancelled, expired
  created_at TIMESTAMP DEFAULT now()
);

-- referrals
referrals (
  id SERIAL PRIMARY KEY,
  referrer_user_id INTEGER REFERENCES users(id),
  referred_telegram_id BIGINT,
  code TEXT,
  rewarded BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- products (one-off)
products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  title TEXT,
  price_cents INTEGER,
  created_at TIMESTAMP DEFAULT now()
);

-- purchases (one-off purchases)
purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  product_id INTEGER REFERENCES products(id),
  provider_payment_id TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

---

## 5. Detailed implementation (Node.js + Telegraf example)

### 5.1 Project structure

```
telegram-bot/
├─ src/
│  ├─ bot.js           # telegraf bot setup
│  ├─ webhook.js       # express webhook server
│  ├─ payments.js      # payment helpers (invoice creation)
│  ├─ db.js            # database connection & queries
│  ├─ referrals.js     # referral code logic
│  └─ admin.js         # simple admin routes
├─ scripts/
├─ .env
├─ package.json
└─ README.md
```

### 5.2 Key environment variables (`.env`)

```
BOT_TOKEN=xxxx:yyyy
WEBHOOK_URL=https://yourdomain.com/webhook
PORT=3000
DB_URL=postgres://user:pass@host/dbname
TELEGRAM_PROVIDER_TOKEN=provider-token-from-BotFather-or-platform
PREMIUM_CHANNEL_ID=@yourprivatechannel
REFERRAL_REWARD_DAYS=3
```

### 5.3 Minimal bot + webhook (Telegraf + Express)

> Notes: this example demonstrates sending an invoice and handling pre-checkout and successful payments. This is a starter — adapt to your exact provider and business logic.

```js
// src/bot.js
const { Telegraf } = require('telegraf');
const { createInvoicePayload } = require('./payments');
const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const startPayload = ctx.startPayload; // referral code if any
  // register user in DB
  await db.upsertUser(ctx.from);
  if (startPayload) await db.recordReferral(ctx.from.id, startPayload);
  return ctx.reply(`Welcome! Type /free to get a sample or /subscribe to join premium.`);
});

bot.command('free', ctx => {
  return ctx.reply('Sample signal: BTC/USDT LONG @ 73k - entry: 72.7k stop: 71.5k target: 75k. Not financial advice.');
});

bot.command('subscribe', async (ctx) => {
  const invoice = createInvoicePayload({
    title: 'Premium Signals – Monthly',
    description: 'Access to private channel + 3-5 signals/week',
    payload: `premium_monthly_${ctx.from.id}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN,
    prices: [{label: 'Monthly', amount: 2500}] // amount in cents
  });
  // send invoice
  await ctx.telegram.sendInvoice(ctx.chat.id, invoice);
});

// handle pre-checkout
bot.on('pre_checkout_query', async (ctx) => {
  try {
    // validate price, payload etc. Here we accept.
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    await ctx.answerPreCheckoutQuery(false, 'Validation failed');
  }
});

// successful payment
bot.on('successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  // save subscription to DB
  await db.createSubscriptionFromPayment(ctx.from, payment);
  // add user to premium (send invite link or add directly if bot is admin)
  const privateLink = await db.getPremiumInviteLink();
  await ctx.reply(`Thanks! Your access is ready: ${privateLink}`);
});

module.exports = bot;
```

```js
// src/webhook.js
const express = require('express');
const bot = require('./bot');

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  // telegraf webhook adapter
  bot.handleUpdate(req.body, res);
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook server running'));
```

Notes:

* `createInvoicePayload` should format newInvoice parameters per Telegram docs (title, description, payload, provider_token, currency, prices array etc.).
* Amounts expect integer values in the smallest currency unit.

### 5.4 Payment helpers (payments.js)

```js
function createInvoicePayload({ title, description, payload, provider_token, prices }) {
  return {
    title,
    description,
    payload,
    provider_token,
    currency: 'USD',
    prices // array of {label, amount}
  };
}
module.exports = { createInvoicePayload };
```

### 5.5 Referral tracking (simple)

* Generate referral codes per user (e.g., `REF${userId}${random}`) and create a `/start` payload when sharing `t.me/YourBot?start=REFCODE`.
* On `/start`, look for `ctx.startPayload` and link referred user to referrer.
* Reward referrer when referred user completes payment: add days to subscription or give credit.

### 5.6 Gating users into premium channel

Two options:

1. **Send invite links**: create a permanent invite link to the private channel and send it to the user upon successful payment. Manage link usage and rotating links if needed.
2. **Bot adds user directly**: make bot an admin of the private channel and call `invite` methods (some actions may require the user to accept). Generally, sending an invite link is simpler and reliable.

Record in DB the date granted and expiry for renewals.

---

## 6. InviteMember alternative (recommended if you want fast, no-code)

InviteMember provides hosted membership pages, billing, renewal reminders, and Telegram integration to automatically add/remove members based on subscription status. Use it if you want to avoid handling Stripe & subscription lifecycle yourself. It's a paid service but accelerates time-to-market.

Steps with InviteMember:

1. Sign up, connect your Telegram bot and channel.
2. Create subscription plans in their dashboard.
3. Use the hosted membership page or bot they provide as the checkout flow.
4. Use webhook or their API to track conversions and referrals if needed.

---

## 7. Deployment & hosting

Options:

* **DigitalOcean Droplet** (simple VPS): SSH deploy, run node process with PM2.
* **Cloud Run / App Engine / Heroku**: deploy container; ensures HTTPS and scaling for webhooks.
* **NGROK** for dev/test webhooks locally.

Remember:

* For Telegraf webhooks you need a valid HTTPS endpoint.
* If using long polling (bot.launch()), you can avoid webhooks for small-scale testing but use webhooks in production.

---

## 8. Security, privacy & compliance

* **No financial guarantees**: add clear disclaimers: "Not financial advice".
* **GDPR & data**: if collecting emails or identifiable data, inform users and keep secure storage.
* **Store minimal sensitive data**: do not store card details — payment processors handle that.
* **Rotate provider tokens** and keep `.env` out of version control.

---

## 9. Testing, monitoring & KPIs

Testing checklist:

* Test `sendInvoice` in Telegram test mode (if provided) or with Stripe test keys.
* Simulate `pre_checkout_query` and `successful_payment` updates.
* Test referral codes and credit issuance.
* Test adding user to premium channel and link expiry.

Monitoring:

* Log payment failures, webhook 500s, bot crashes.
* Track daily conversion metrics.

KPIs to watch (daily/weekly):

* Bot starts (new users)
* Conversion rate (subscribers ÷ visitors)
* Revenue per day
* Referral conversion rate
* Churn rate (monthly)

---

## 10. Sample messages, copy & partner templates

**Welcome**

> Welcome to [BotName]! Free sample available via `/free`. To join premium (3–5 trade ideas/week + rationale), type `/subscribe` or visit [landing link].

**Referral**

> Join my premium signals with code `REF123` and we both get 3 free days. Start: t.me/YourBot?start=REF123

**Partner pitch (for channel owners)**

> Hi [Name], I run an engaged crypto signals product. I can offer a 30% revenue share on conversions from a dedicated shoutout. Would you like to test with a single post? I'll provide UTM tracking and a promo code.

---

## 11. Troubleshooting & common gotchas

* **Invoice keeps loading**: Often due to missing or misconfigured provider token or Stripe test mode. Verify provider token and that Stripe account is fully configured.
* **PreCheckout failures**: Ensure you answer pre-checkout queries quickly and validate payload.
* **Bot cannot add user to channel**: Ensure bot has admin rights and appropriate permissions.
* **Refunds**: Decide refund policy and implement admin endpoints for issuing refunds via payment provider.

---

## 12. 30-day execution checklist (practical)

**Day 0–2**: Decide product, price, provider. Create Bot, register `.env` keys.

**Day 3–7**: Build bot skeleton, landing page, payment integration; prepare sample content.

**Day 8–14**: Soft launch to test users, fix bugs, prepare outreach list (10–20 channels).

**Day 15–21**: Run partner shoutouts and referral push. Monitor conversions and iterate copy.

**Day 22–30**: Optimize top acquisition channels, add upsell (ebook or 1:1), scale paid shoutouts if ROI positive.

---

## Appendix — resources & links

* Telegram Bot API docs — payments: [https://core.telegram.org/bots/payments](https://core.telegram.org/bots/payments)
* Telegraf docs: [https://telegraf.js.org](https://telegraf.js.org)
* InviteMember: [https://invitemember.com](https://invitemember.com)

---
