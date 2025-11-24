// Vercel serverless function for webhook
import { Telegraf, Markup } from 'telegraf';

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Simple user tracking with preferences (without database for now)
const users = new Map();

async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  
  if (!users.has(id)) {
    users.set(id, {
      telegram_id: id,
      username,
      display_name,
      preferred_markets: null, // will be set when user chooses
      created_at: new Date().toISOString()
    });
  }
  
  return users.get(id);
}

function setUserPreferences(telegramId, preferences) {
  if (users.has(telegramId)) {
    const user = users.get(telegramId);
    user.preferred_markets = preferences.markets;
    user.signal_preferences = preferences;
    users.set(telegramId, user);
  }
}

function getUserPreferences(telegramId) {
  const user = users.get(telegramId);
  return user?.preferred_markets || null;
}

// Bot commands
bot.start(async (ctx) => {
  try {
    const startPayload = ctx.startPayload;
    await upsertUser(ctx.from);
    
    const userPrefs = getUserPreferences(ctx.from.id);
    
    if (!userPrefs) {
      // First time user - ask for preferences
      await ctx.reply(
        `Welcome to ArodonnaSignals Bot! 🚀\n\n` +
        `We provide professional trading signals for both crypto and forex markets.\n\n` +
        `**What signals are you interested in?**`,
        Markup.inlineKeyboard([
          [Markup.button.callback('₿ Crypto Signals', 'pref_crypto')],
          [Markup.button.callback('💱 Forex Signals', 'pref_forex')],
          [Markup.button.callback('🌍 Both Markets', 'pref_both')]
        ])
      );
      return;
    }
    
    // Returning user with preferences
    const marketText = userPrefs === 'crypto' ? 'crypto' : userPrefs === 'forex' ? 'forex' : 'crypto & forex';
    
    if (startPayload && startPayload.startsWith('REF')) {
      await ctx.reply(
        `🎉 Welcome back ${ctx.from.first_name}! You've been referred by a friend.\n\n` +
        `You're set to receive **${marketText}** signals. Ready to upgrade to premium?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📈 Free Sample', 'free_sample')],
          [Markup.button.callback('💎 Subscribe', 'subscribe')],
          [Markup.button.callback('⚙️ Change Preferences', 'change_prefs')]
        ])
      );
    } else {
      await ctx.reply(
        `Welcome back to ArodonnaSignals! 📊\n\n` +
        `You're receiving **${marketText}** signals.\n\n` +
        `• Free sample signals available\n` +
        `• Premium: 3-5 high-quality signals/week\n` +
        `• Educational content included\n` +
        `• Referral rewards program`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📈 Free Sample', 'free_sample')],
          [Markup.button.callback('💎 Subscribe', 'subscribe')],
          [Markup.button.callback('🔗 Refer Friends', 'referral')],
          [Markup.button.callback('⚙️ Settings', 'settings')]
        ])
      );
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('Sorry, something went wrong. Please try again.');
  }
});

bot.command('free', async (ctx) => {
  await sendFreeSample(ctx);
});

bot.action('free_sample', async (ctx) => {
  await ctx.answerCbQuery();
  await sendFreeSample(ctx);
});

async function sendFreeSample(ctx) {
  try {
    const userPrefs = getUserPreferences(ctx.from.id);
    
    const cryptoSignals = [
      {
        pair: 'BTC/USDT',
        direction: 'LONG',
        entry: '73,500',
        stop: '71,200',
        target: '76,800',
        confidence: '85%',
        market: 'crypto'
      },
      {
        pair: 'ETH/USDT', 
        direction: 'SHORT',
        entry: '3,420',
        stop: '3,580',
        target: '3,180',
        confidence: '78%',
        market: 'crypto'
      }
    ];
    
    const forexSignals = [
      {
        pair: 'EUR/USD',
        direction: 'LONG',
        entry: '1.0450',
        stop: '1.0380',
        target: '1.0580',
        confidence: '82%',
        market: 'forex'
      },
      {
        pair: 'GBP/JPY',
        direction: 'SHORT',
        entry: '195.50',
        stop: '197.20',
        target: '192.80',
        confidence: '88%',
        market: 'forex'
      }
    ];
    
    let availableSignals = [];
    
    if (userPrefs === 'crypto') {
      availableSignals = cryptoSignals;
    } else if (userPrefs === 'forex') {
      availableSignals = forexSignals;
    } else {
      availableSignals = [...cryptoSignals, ...forexSignals];
    }
    
    const randomSignal = availableSignals[Math.floor(Math.random() * availableSignals.length)];
    const marketEmoji = randomSignal.market === 'crypto' ? '₿' : '💱';
    
    await ctx.reply(
      `${marketEmoji} **FREE SAMPLE SIGNAL**\n\n` +
      `**Market:** ${randomSignal.market.toUpperCase()}\n` +
      `**Pair:** ${randomSignal.pair}\n` +
      `**Direction:** ${randomSignal.direction}\n` +
      `**Entry:** ${randomSignal.entry}\n` +
      `**Stop Loss:** ${randomSignal.stop}\n` +
      `**Target:** ${randomSignal.target}\n` +
      `**Confidence:** ${randomSignal.confidence}\n\n` +
      `⚠️ *This is not financial advice. Trade at your own risk.*\n\n` +
      `Ready for premium signals? Get 3-5 signals per week!`,
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💎 Subscribe Now', 'subscribe')],
          [Markup.button.callback('🔗 Refer & Earn', 'referral')],
          [Markup.button.callback('⚙️ Change Markets', 'change_prefs')]
        ])
      }
    );
  } catch (error) {
    console.error('Error sending free sample:', error);
    await ctx.reply('Sorry, unable to send sample right now. Please try again later.');
  }
}

// Handle preference selection
bot.action('pref_crypto', async (ctx) => {
  await ctx.answerCbQuery();
  setUserPreferences(ctx.from.id, { markets: 'crypto' });
  await ctx.reply(
    `₿ **Crypto Signals Selected!**\n\n` +
    `You'll receive Bitcoin, Ethereum, Altcoin and other crypto trading signals.\n\n` +
    `Start with a free sample!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📈 Free Crypto Sample', 'free_sample')],
      [Markup.button.callback('💎 Subscribe to Premium', 'subscribe')],
      [Markup.button.callback('⚙️ Change Preferences', 'change_prefs')]
    ])
  );
});

bot.action('pref_forex', async (ctx) => {
  await ctx.answerCbQuery();
  setUserPreferences(ctx.from.id, { markets: 'forex' });
  await ctx.reply(
    `💱 **Forex Signals Selected!**\n\n` +
    `You'll receive EUR/USD, GBP/JPY, USD/CAD and other forex pair signals.\n\n` +
    `Start with a free sample!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📈 Free Forex Sample', 'free_sample')],
      [Markup.button.callback('💎 Subscribe to Premium', 'subscribe')],
      [Markup.button.callback('⚙️ Change Preferences', 'change_prefs')]
    ])
  );
});

bot.action('pref_both', async (ctx) => {
  await ctx.answerCbQuery();
  setUserPreferences(ctx.from.id, { markets: 'both' });
  await ctx.reply(
    `🌍 **Both Markets Selected!**\n\n` +
    `You'll receive signals from both crypto and forex markets for maximum opportunities.\n\n` +
    `Start with a free sample!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📈 Free Sample', 'free_sample')],
      [Markup.button.callback('💎 Subscribe to Premium', 'subscribe')],
      [Markup.button.callback('⚙️ Change Preferences', 'change_prefs')]
    ])
  );
});

bot.action('change_prefs', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `⚙️ **Change Signal Preferences**\n\n` +
    `What signals would you like to receive?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('₿ Crypto Only', 'pref_crypto')],
      [Markup.button.callback('💱 Forex Only', 'pref_forex')],
      [Markup.button.callback('🌍 Both Markets', 'pref_both')],
      [Markup.button.callback('⬅️ Back', 'back_to_menu')]
    ])
  );
});

bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  const userPrefs = getUserPreferences(ctx.from.id);
  const marketText = userPrefs === 'crypto' ? 'Crypto Only' : userPrefs === 'forex' ? 'Forex Only' : 'Both Markets';
  
  await ctx.reply(
    `⚙️ **Your Settings**\n\n` +
    `**Current Preference:** ${marketText}\n\n` +
    `What would you like to do?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📈 Get Free Sample', 'free_sample')],
      [Markup.button.callback('⚙️ Change Markets', 'change_prefs')],
      [Markup.button.callback('💎 Subscribe Premium', 'subscribe')],
      [Markup.button.callback('⬅️ Back', 'back_to_menu')]
    ])
  );
});

bot.action('subscribe', async (ctx) => {
  await ctx.answerCbQuery();
  const userPrefs = getUserPreferences(ctx.from.id);
  const marketText = userPrefs === 'crypto' ? 'crypto' : userPrefs === 'forex' ? 'forex' : 'crypto & forex';
  
  await ctx.reply(
    `💎 **PREMIUM SUBSCRIPTION** (Coming Soon!)\n\n` +
    `We're setting up payments for **${marketText}** signals.\n\n` +
    `Premium features will include:\n` +
    `✅ 3-5 high-quality signals per week\n` +
    `✅ Private premium channel\n` +
    `✅ Educational content & analysis\n` +
    `✅ Entry, stop-loss, and target levels\n` +
    `✅ Risk management guidance\n` +
    `✅ Real-time signal updates\n\n` +
    `Follow us for updates! 🚀`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const userPrefs = getUserPreferences(ctx.from.id);
  const marketText = userPrefs === 'crypto' ? 'crypto' : userPrefs === 'forex' ? 'forex' : 'crypto & forex';
  
  await ctx.reply(
    `🏠 **MAIN MENU**\n\n` +
    `Current signals: **${marketText}**\n\n` +
    `What would you like to do?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📈 Free Sample', 'free_sample')],
        [Markup.button.callback('💎 Subscribe', 'subscribe')],
        [Markup.button.callback('🔗 Refer Friends', 'referral')],
        [Markup.button.callback('⚙️ Settings', 'settings')]
      ])
    }
  );
});

bot.action('about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `ℹ️ **ABOUT ARODONNA SIGNALS BOT**\n\n` +
    `Professional crypto & forex trading signals with educational content.\n\n` +
    `**Markets:**\n` +
    `₿ Crypto: BTC, ETH, Altcoins\n` +
    `💱 Forex: Major & exotic pairs\n\n` +
    `**Features:**\n` +
    `• Free sample signals\n` +
    `• Premium subscription plans\n` +
    `• Market preference selection\n` +
    `• Educational resources\n` +
    `• Referral rewards program\n` +
    `• 24/7 signal delivery\n\n` +
    `**Disclaimer:**\n` +
    `All signals are for educational purposes only. This is not financial advice. Trade at your own risk.\n\n` +
    `Questions? Contact @ArodonnaSupport`,
    { parse_mode: 'Markdown' }
  );
});

// (diagnostic handler removed)

bot.command('help', async (ctx) => {
  await ctx.reply(
    `🤖 **HELP & COMMANDS**\n\n` +
    `**/start** - Start the bot\n` +
    `**/free** - Get free sample signal\n` +
    `**/subscribe** - View subscription options (coming soon)\n` +
    `**/help** - Show this help message\n\n` +
    `**Need support?** Contact @ArodonnaSupport`,
    { parse_mode: 'Markdown' }
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// Vercel serverless function handler
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      // Handle Telegram webhook
      console.log('Webhook received:', req.body);
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else if (req.method === 'GET') {
      // Health check
      res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        bot: '@ArodonnaSignalsBot',
        webhook_url: 'https://signal-bot-lyart.vercel.app/webhook',
        environment: 'vercel'
      });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
