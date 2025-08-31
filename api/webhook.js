// Vercel serverless function for webhook
import { Telegraf, Markup } from 'telegraf';

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Simple user tracking (without database for now)
const users = new Map();

async function upsertUser(userInfo) {
  const { id, username, first_name, last_name } = userInfo;
  const display_name = [first_name, last_name].filter(Boolean).join(' ');
  
  users.set(id, {
    telegram_id: id,
    username,
    display_name,
    created_at: new Date().toISOString()
  });
  
  return users.get(id);
}

// Bot commands
bot.start(async (ctx) => {
  try {
    const startPayload = ctx.startPayload;
    await upsertUser(ctx.from);
    
    if (startPayload && startPayload.startsWith('REF')) {
      await ctx.reply(
        `🎉 Welcome ${ctx.from.first_name}! You've been referred by a friend. You'll both get 3 free days when you subscribe!\n\n` +
        `Type /free to get a sample signal or /subscribe to join premium.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📈 Free Sample', 'free_sample')],
          [Markup.button.callback('💎 Subscribe', 'subscribe')],
          [Markup.button.callback('ℹ️ About', 'about')]
        ])
      );
    } else {
      await ctx.reply(
        `Welcome to ArodonnaSignals Bot! 🚀\n\n` +
        `Get professional crypto trading signals and learn from experts.\n\n` +
        `• Free sample signals available\n` +
        `• Premium: 3-5 high-quality signals/week\n` +
        `• Educational content included\n` +
        `• Referral rewards program\n\n` +
        `Type /free for a sample or /subscribe to join premium.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📈 Free Sample', 'free_sample')],
          [Markup.button.callback('💎 Subscribe', 'subscribe')],
          [Markup.button.callback('🔗 Refer Friends', 'referral')],
          [Markup.button.callback('ℹ️ About', 'about')]
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
    const sampleSignals = [
      {
        coin: 'BTC/USDT',
        direction: 'LONG',
        entry: '73,500',
        stop: '71,200',
        target: '76,800',
        confidence: '85%'
      },
      {
        coin: 'ETH/USDT', 
        direction: 'SHORT',
        entry: '3,420',
        stop: '3,580',
        target: '3,180',
        confidence: '78%'
      }
    ];
    
    const randomSignal = sampleSignals[Math.floor(Math.random() * sampleSignals.length)];
    
    await ctx.reply(
      `📈 **FREE SAMPLE SIGNAL**\n\n` +
      `**Pair:** ${randomSignal.coin}\n` +
      `**Direction:** ${randomSignal.direction}\n` +
      `**Entry:** ${randomSignal.entry}\n` +
      `**Stop Loss:** ${randomSignal.stop}\n` +
      `**Target:** ${randomSignal.target}\n` +
      `**Confidence:** ${randomSignal.confidence}\n\n` +
      `⚠️ *This is not financial advice. Trade at your own risk.*\n\n` +
      `Ready for premium signals? /subscribe for 3-5 signals per week!`,
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💎 Subscribe Now', 'subscribe')],
          [Markup.button.callback('🔗 Refer & Earn', 'referral')]
        ])
      }
    );
  } catch (error) {
    console.error('Error sending free sample:', error);
    await ctx.reply('Sorry, unable to send sample right now. Please try again later.');
  }
}

bot.action('subscribe', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `💎 **PREMIUM SUBSCRIPTION** (Coming Soon!)\n\n` +
    `We're setting up payments. For now, enjoy free samples!\n\n` +
    `Premium features will include:\n` +
    `✅ 3-5 high-quality signals per week\n` +
    `✅ Private premium channel\n` +
    `✅ Educational content & analysis\n` +
    `✅ Entry, stop-loss, and target levels\n` +
    `✅ Risk management guidance\n\n` +
    `Follow us for updates! 🚀`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `ℹ️ **ABOUT ARODONNA SIGNALS BOT**\n\n` +
    `Professional crypto trading signals and educational content.\n\n` +
    `**Features:**\n` +
    `• Free sample signals\n` +
    `• Premium subscription plans (coming soon)\n` +
    `• Educational resources\n` +
    `• Referral rewards program\n` +
    `• 24/7 signal delivery\n\n` +
    `**Disclaimer:**\n` +
    `All signals are for educational purposes only. This is not financial advice. Trade at your own risk.\n\n` +
    `Questions? Contact @ArodonnaSupport`,
    { parse_mode: 'Markdown' }
  );
});

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
