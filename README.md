# Telegram Crypto Trading Bot

A comprehensive Telegram bot for crypto trading signals and learning products with payment processing, referral tracking, and premium member management.

## Features

- **Free Sample Signals**: Attract users with free trading signals
- **Premium Subscriptions**: Monthly/yearly paid subscriptions
- **One-off Products**: eBooks, courses, consultations
- **Referral System**: Reward users for bringing friends
- **Payment Processing**: Telegram Payments integration
- **Premium Channel Management**: Automatic user gating
- **Admin Dashboard**: User management and analytics
- **Database Integration**: PostgreSQL with comprehensive schema

## Quick Start

### Prerequisites

- Node.js 16+ 
- PostgreSQL database
- Telegram Bot Token (from @BotFather)
- Payment Provider Token (Stripe/Telegram Payments)

### Installation

1. Clone and install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Set up database:
```bash
# Create PostgreSQL database
createdb telegram_crypto_bot

# Run schema setup
psql telegram_crypto_bot < scripts/setup-database.sql
```

4. Configure your bot:
   - Get bot token from @BotFather
   - Set up payment provider (Stripe recommended)
   - Create private premium channel
   - Add bot as admin to premium channel

### Running the Bot

**Development (polling mode):**
```bash
npm run dev
```

**Production (webhook mode):**
```bash
npm run webhook
```

**Both modes:**
```bash
npm start
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Bot Configuration
BOT_TOKEN=your_bot_token_from_botfather
WEBHOOK_URL=https://yourdomain.com/webhook
PORT=3000

# Database
DB_URL=postgres://username:password@localhost:5432/telegram_crypto_bot

# Payments
TELEGRAM_PROVIDER_TOKEN=your_provider_token

# Premium Channel
PREMIUM_CHANNEL_ID=@yourprivatechannel
PREMIUM_CHANNEL_INVITE_LINK=https://t.me/+your_invite_link

# Referrals
REFERRAL_REWARD_DAYS=3

# Admin
ADMIN_TOKEN=your_secure_admin_token
ADMIN_TELEGRAM_ID=your_telegram_user_id
```

If you use the AI signal integration (signal_bot), also set the MongoDB connection variables below:

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=signal_bot_db
SIGNALS_COLLECTION=ai_signals
SIGNAL_POLL_INTERVAL_MS=60000
```

## Bot Commands

### User Commands
- `/start` - Welcome message and referral handling
- `/free` - Get free sample signal
- `/subscribe` - View subscription options  
- `/help` - Show available commands

### Admin Commands
Access admin panel at `/admin/*` with proper authentication.

## Project Structure

```
telegram-crypto-bot/
├── src/
│   ├── bot.js          # Main bot logic
│   ├── webhook.js      # Express webhook server
│   ├── payments.js     # Payment helpers
│   ├── db.js           # Database queries
│   ├── referrals.js    # Referral system
│   └── admin.js        # Admin routes
├── scripts/
│   └── setup-database.sql  # Database schema
├── .env.example        # Environment template
├── package.json        # Dependencies
└── README.md
```

## Database Schema

### Core Tables
- `users` - User information
- `subscriptions` - Premium subscriptions
- `referrals` - Referral tracking
- `products` - One-off products
- `purchases` - Product purchases
- `payment_logs` - Payment tracking
- `bot_analytics` - Usage analytics

### Key Features
- Automatic timestamps
- Referential integrity
- Performance indexes
- Data cleanup functions

## Payment Integration

### Telegram Payments
The bot uses Telegram's native payment system with provider tokens from @BotFather.

**Supported flows:**
- Monthly subscription ($25)
- Yearly subscription ($250)
- One-off products (eBooks, courses)

### Alternative: InviteMember
For faster deployment, consider InviteMember integration:
- Hosted payment pages
- Automatic member management
- Subscription lifecycle handling

## Referral System

**Features:**
- Unique referral codes per user
- 3 free days reward for successful referrals  
- Automatic reward distribution
- Referral statistics and leaderboards

**Code format:** `REF{userId}{random6chars}`

## Admin Dashboard

Access admin features at `/admin/*`:

### Available Endpoints
- `GET /admin/dashboard` - Overview statistics
- `GET /admin/users` - User management
- `GET /admin/subscriptions` - Subscription management
- `GET /admin/referrals/stats` - Referral analytics
- `POST /admin/broadcast` - Send messages to users
- `GET /admin/export/user/:id` - GDPR data export

### Authentication
Use Bearer token authentication:
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" http://localhost:3000/admin/dashboard
```

## Deployment

### DigitalOcean Droplet
1. Create Ubuntu 20.04 droplet
2. Install Node.js and PostgreSQL
3. Clone repository
4. Set up environment variables
5. Use PM2 for process management:
```bash
npm install -g pm2
pm2 start src/webhook.js --name telegram-bot
```

### Cloud Platforms
- **Heroku**: Add PostgreSQL addon, set environment variables
- **Railway**: Connect GitHub, add PostgreSQL database
- **Cloud Run**: Containerize and deploy with Cloud SQL

### Domain & HTTPS
Required for webhook mode:
- Domain with SSL certificate
- Webhook URL: `https://yourdomain.com/webhook`

## Security Best Practices

- ✅ Rate limiting on all endpoints
- ✅ Input validation and sanitization
- ✅ Secure token storage
- ✅ HTTPS for webhooks
- ✅ Admin authentication
- ✅ Database connection pooling
- ✅ Error logging without sensitive data

## Testing

### Manual Testing Checklist
- [ ] Bot responds to /start command
- [ ] Free samples work
- [ ] Payment flow completes
- [ ] Premium channel access granted
- [ ] Referral codes work
- [ ] Admin dashboard accessible

### Payment Testing
Use Stripe test mode or Telegram test environment for safe testing.

## Monitoring

### Key Metrics
- New users per day
- Conversion rate (free → paid)
- Referral success rate
- Monthly recurring revenue
- Churn rate

### Logging
All important events are logged:
- Payment processing
- User registrations
- Referral rewards
- Admin actions

## Business Model

### Revenue Streams
1. **Monthly subscriptions**: $25/month
2. **Annual subscriptions**: $250/year (17% discount)
3. **Digital products**: eBooks, courses ($19-199)
4. **Referral bonuses**: 3 free days per referral

### 30-Day Goal
Reach $1,000 MRR through:
- 40 monthly subscribers OR
- 4 annual subscribers OR  
- Mix of subscriptions + product sales

## Support & Community

### Getting Help
- Check logs for error messages
- Review environment configuration
- Test database connectivity
- Verify Telegram bot token

### Common Issues

**Bot not responding:**
- Verify BOT_TOKEN is correct
- Check if webhook URL is accessible
- Ensure database connection works

**Payments failing:**
- Confirm provider token configuration
- Check Stripe/payment provider settings
- Verify webhook URLs match

**Users not added to premium channel:**
- Bot must be admin of premium channel
- Check PREMIUM_CHANNEL_ID format
- Verify invite link is valid

## License

MIT License - feel free to use for commercial projects.

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

---

**Disclaimer**: This bot is for educational purposes. All trading signals are not financial advice. Users trade at their own risk.
"# signalBot" 
