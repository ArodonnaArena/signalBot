require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createInvoicePayload } = require('./payments');
const db = require('./db');
const { generateReferralCode, generateReferralLink } = require('./referrals');
const { startSignalConsumer } = require('./signalConsumer');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware to register user
bot.use(async (ctx, next) => {
  try {
    if (ctx.from) {
      await db.upsertUser(ctx.from);
    }
    return next();
  } catch (error) {
    console.error('Error in user middleware:', error);
    return next();
  }
});

// Start command - handles referrals
bot.start(async (ctx) => {
  try {
    const startPayload = ctx.startPayload; // referral code if any
    const user = ctx.from;
    
    if (startPayload && startPayload.startsWith('REF')) {
      await db.recordReferral(user.id, startPayload);
      await ctx.reply(
        `🎉 Welcome ${user.first_name}! You've been referred by a friend. You'll both get 3 free days when you subscribe!\n\n` +
        `Type /free to get a sample signal or /subscribe to join premium.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📈 Free Sample', 'free_sample')],
          [Markup.button.callback('💎 Subscribe', 'subscribe')],
          [Markup.button.callback('ℹ️ About', 'about')]
        ])
      );
    } else {
      await ctx.reply(
        `Welcome to CryptoSignals Bot! 🚀\n\n` +
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

// Free sample command
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

// Subscribe command
bot.command('subscribe', async (ctx) => {
  await showSubscriptionOptions(ctx);
});

bot.action('subscribe', async (ctx) => {
  await ctx.answerCbQuery();
  await showSubscriptionOptions(ctx);
});

async function showSubscriptionOptions(ctx) {
  try {
    await ctx.reply(
      `💎 **PREMIUM SUBSCRIPTION**\n\n` +
      `Get exclusive access to:\n` +
      `✅ 3-5 high-quality signals per week\n` +
      `✅ Private premium channel\n` +
      `✅ Educational content & analysis\n` +
      `✅ Entry, stop-loss, and target levels\n` +
      `✅ Risk management guidance\n\n` +
      `Choose your plan:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📅 Monthly - $25', 'subscribe_monthly')],
          [Markup.button.callback('📅 Yearly - $250 (2 months free!)', 'subscribe_yearly')],
          [Markup.button.callback('📚 Trading eBook - $19', 'buy_ebook')],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error showing subscription options:', error);
    await ctx.reply('Sorry, unable to show subscription options. Please try again.');
  }
}

// Subscription handlers
bot.action('subscribe_monthly', async (ctx) => {
  await ctx.answerCbQuery();
  await sendInvoice(ctx, 'monthly');
});

bot.action('subscribe_yearly', async (ctx) => {
  await ctx.answerCbQuery();
  await sendInvoice(ctx, 'yearly');
});

bot.action('buy_ebook', async (ctx) => {
  await ctx.answerCbQuery();
  await sendInvoice(ctx, 'ebook');
});

async function sendInvoice(ctx, plan) {
  try {
    let invoiceData;
    
    switch (plan) {
      case 'monthly':
        invoiceData = {
          title: 'Premium Signals - Monthly',
          description: 'Access to private channel with 3-5 premium signals per week',
          payload: `premium_monthly_${ctx.from.id}`,
          prices: [{ label: 'Monthly Subscription', amount: 2500 }] // $25.00
        };
        break;
      case 'yearly':
        invoiceData = {
          title: 'Premium Signals - Yearly',
          description: 'Annual access with 2 months free! Private channel + premium signals',
          payload: `premium_yearly_${ctx.from.id}`,
          prices: [{ label: 'Yearly Subscription', amount: 25000 }] // $250.00
        };
        break;
      case 'ebook':
        invoiceData = {
          title: 'Crypto Trading Masterclass eBook',
          description: 'Complete guide to crypto trading strategies and risk management',
          payload: `ebook_${ctx.from.id}`,
          prices: [{ label: 'Trading eBook', amount: 1900 }] // $19.00
        };
        break;
    }
    
    const invoice = createInvoicePayload({
      ...invoiceData,
      provider_token: process.env.TELEGRAM_PROVIDER_TOKEN
    });
    
    await ctx.telegram.sendInvoice(ctx.chat.id, invoice);
  } catch (error) {
    console.error('Error sending invoice:', error);
    await ctx.reply('Sorry, unable to process payment right now. Please try again later.');
  }
}

// Pre-checkout handler
bot.on('pre_checkout_query', async (ctx) => {
  try {
    const query = ctx.preCheckoutQuery;
    console.log('Pre-checkout query received:', query);
    
    // Validate the payment
    if (query.total_amount > 0 && query.currency === 'USD') {
      await ctx.answerPreCheckoutQuery(true);
    } else {
      await ctx.answerPreCheckoutQuery(false, 'Invalid payment details');
    }
  } catch (error) {
    console.error('Error in pre-checkout:', error);
    await ctx.answerPreCheckoutQuery(false, 'Payment validation failed');
  }
});

// Successful payment handler
bot.on('successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const user = ctx.from;
    
    console.log('Payment received:', payment);
    
    // Save subscription to database
    await db.createSubscriptionFromPayment(user, payment);
    
    // Handle referral rewards
    const referral = await db.getReferralByUser(user.id);
    if (referral && !referral.rewarded) {
      await db.rewardReferral(referral.id);
      // Notify referrer
      try {
        await ctx.telegram.sendMessage(
          referral.referrer_telegram_id,
          `🎉 Great news! Someone you referred just subscribed. You've earned 3 free days!`
        );
      } catch (error) {
        console.error('Error notifying referrer:', error);
      }
    }
    
    if (payment.invoice_payload.includes('premium')) {
      // Grant premium access
      const inviteLink = process.env.PREMIUM_CHANNEL_INVITE_LINK;
      
      await ctx.reply(
        `🎉 **Payment Successful!**\n\n` +
        `Thank you for subscribing to Premium Signals!\n\n` +
        `**Your benefits:**\n` +
        `✅ Access to private premium channel\n` +
        `✅ 3-5 high-quality signals per week\n` +
        `✅ Educational content and analysis\n\n` +
        `**Join the premium channel:** ${inviteLink}\n\n` +
        `Welcome to the community! 🚀`,
        { parse_mode: 'Markdown' }
      );
    } else if (payment.invoice_payload.includes('ebook')) {
      // Send ebook download link
      await ctx.reply(
        `📚 **Thank you for your purchase!**\n\n` +
        `Your Crypto Trading Masterclass eBook is ready for download.\n\n` +
        `[Download your eBook here](https://your-domain.com/downloads/crypto-trading-ebook.pdf)\n\n` +
        `The link will remain active for 30 days.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error handling successful payment:', error);
    await ctx.reply('Payment received! There was a technical issue, but your access will be granted shortly.');
  }
});

// Referral system
bot.action('referral', async (ctx) => {
  await ctx.answerCbQuery();
  await showReferralInfo(ctx);
});

async function showReferralInfo(ctx) {
  try {
    const user = ctx.from;
    const referralCode = generateReferralCode(user.id);
    const referralLink = generateReferralLink(referralCode);
    
    const referralStats = await db.getReferralStats(user.id);
    
    await ctx.reply(
      `🔗 **REFERRAL PROGRAM**\n\n` +
      `Earn 3 free days for each friend who subscribes!\n\n` +
      `**Your referral link:**\n` +
      `${referralLink}\n\n` +
      `**Your stats:**\n` +
      `👥 Referred: ${referralStats.total_referrals}\n` +
      `💰 Rewards earned: ${referralStats.total_rewards} days\n\n` +
      `Share your link and start earning! 🚀`,
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📱 Share Link', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`)],
          [Markup.button.callback('⬅️ Back', 'back_to_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error showing referral info:', error);
    await ctx.reply('Sorry, unable to show referral information right now.');
  }
}

// About command
bot.action('about', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `ℹ️ **ABOUT CRYPTOSIGNALS BOT**\n\n` +
    `Professional crypto trading signals and educational content.\n\n` +
    `**Features:**\n` +
    `• Free sample signals\n` +
    `• Premium subscription plans\n` +
    `• Educational resources\n` +
    `• Referral rewards program\n` +
    `• 24/7 signal delivery\n\n` +
    `**Disclaimer:**\n` +
    `All signals are for educational purposes only. This is not financial advice. Trade at your own risk.\n\n` +
    `Questions? Contact @yoursupport`,
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back', 'back_to_menu')]
      ])
    }
  );
});

// Back to menu
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🏠 **MAIN MENU**\n\nWhat would you like to do?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📈 Free Sample', 'free_sample')],
        [Markup.button.callback('💎 Subscribe', 'subscribe')],
        [Markup.button.callback('🔗 Refer Friends', 'referral')],
        [Markup.button.callback('ℹ️ About', 'about')]
      ])
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  await ctx.reply(
    `🤖 **HELP & COMMANDS**\n\n` +
    `**/start** - Start the bot\n` +
    `**/free** - Get free sample signal\n` +
    `**/subscribe** - View subscription options\n` +
    `**/help** - Show this help message\n\n` +
    `**Need support?** Contact @yoursupport`,
    { parse_mode: 'Markdown' }
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  console.error('Context:', ctx.update);
});

// Export bot for use in webhook.js
module.exports = bot;

// Start bot if running directly
if (require.main === module) {
  (async () => {
    try {
      // Start signal consumer first (no-op if not configured)
      await startSignalConsumer(bot);

      await bot.launch();
      console.log('Bot started successfully');
    } catch (error) {
      console.error('Failed to start bot or signal consumer:', error);
      process.exit(1);
    }
  })();

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
