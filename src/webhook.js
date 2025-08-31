require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bot = require('./bot');
const admin = require('./admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Parse JSON bodies
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Telegram webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // Process the update with Telegraf
    await bot.handleUpdate(req.body, res);
    
    // Respond to Telegram
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Admin routes
app.use('/admin', admin);

// InviteMember webhook (if using InviteMember)
app.post('/webhook/invitemember', async (req, res) => {
  try {
    const signature = req.headers['x-invitemember-signature'];
    const webhookSecret = process.env.INVITEMEMBER_WEBHOOK_SECRET;
    
    // Verify webhook signature if configured
    if (webhookSecret && signature) {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        console.error('Invalid InviteMember webhook signature');
        return res.sendStatus(401);
      }
    }
    
    const event = req.body;
    console.log('InviteMember webhook:', event);
    
    // Handle different InviteMember events
    switch (event.type) {
      case 'subscription.created':
        await handleSubscriptionCreated(event.data);
        break;
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(event.data);
        break;
      case 'subscription.expired':
        await handleSubscriptionExpired(event.data);
        break;
      case 'payment.succeeded':
        await handlePaymentSucceeded(event.data);
        break;
      default:
        console.log('Unhandled InviteMember event:', event.type);
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('InviteMember webhook error:', error);
    res.sendStatus(500);
  }
});

// Stripe webhook (if using Stripe directly)
app.post('/webhook/stripe', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (webhookSecret && signature) {
      // Verify Stripe webhook signature
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        webhookSecret
      );
      
      console.log('Stripe webhook:', event.type);
      
      // Handle Stripe events
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await handleStripePaymentSucceeded(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleStripeSubscriptionDeleted(event.data.object);
          break;
        default:
          console.log('Unhandled Stripe event:', event.type);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.sendStatus(500);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Express error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// InviteMember event handlers
async function handleSubscriptionCreated(data) {
  try {
    const db = require('./db');
    console.log('New subscription created:', data);
    
    // Add user to premium channel if telegram_id is available
    if (data.telegram_id && process.env.PREMIUM_CHANNEL_ID) {
      try {
        await bot.telegram.unbanChatMember(
          process.env.PREMIUM_CHANNEL_ID,
          data.telegram_id
        );
        
        // Send welcome message
        await bot.telegram.sendMessage(
          data.telegram_id,
          '🎉 Welcome to Premium! You now have access to exclusive signals and content.'
        );
      } catch (error) {
        console.error('Error adding user to premium channel:', error);
      }
    }
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

async function handleSubscriptionCancelled(data) {
  try {
    console.log('Subscription cancelled:', data);
    
    // Remove user from premium channel if telegram_id is available
    if (data.telegram_id && process.env.PREMIUM_CHANNEL_ID) {
      try {
        await bot.telegram.banChatMember(
          process.env.PREMIUM_CHANNEL_ID,
          data.telegram_id
        );
        
        // Send cancellation message
        await bot.telegram.sendMessage(
          data.telegram_id,
          '📭 Your premium subscription has been cancelled. We hope to see you back soon!'
        );
      } catch (error) {
        console.error('Error removing user from premium channel:', error);
      }
    }
  } catch (error) {
    console.error('Error handling subscription cancelled:', error);
  }
}

async function handleSubscriptionExpired(data) {
  try {
    console.log('Subscription expired:', data);
    
    // Remove user from premium channel
    if (data.telegram_id && process.env.PREMIUM_CHANNEL_ID) {
      try {
        await bot.telegram.banChatMember(
          process.env.PREMIUM_CHANNEL_ID,
          data.telegram_id
        );
        
        // Send expiration message with renewal option
        await bot.telegram.sendMessage(
          data.telegram_id,
          '⏰ Your premium subscription has expired. Renew now to continue receiving exclusive signals!\n\n' +
          'Type /subscribe to renew your subscription.'
        );
      } catch (error) {
        console.error('Error removing expired user from premium channel:', error);
      }
    }
  } catch (error) {
    console.error('Error handling subscription expired:', error);
  }
}

async function handlePaymentSucceeded(data) {
  try {
    console.log('Payment succeeded:', data);
    
    // Update database with payment information
    const db = require('./db');
    // Add your payment tracking logic here
  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
}

// Stripe event handlers
async function handleStripePaymentSucceeded(invoice) {
  try {
    console.log('Stripe payment succeeded:', invoice);
    // Handle Stripe payment success
  } catch (error) {
    console.error('Error handling Stripe payment:', error);
  }
}

async function handleStripeSubscriptionDeleted(subscription) {
  try {
    console.log('Stripe subscription deleted:', subscription);
    // Handle Stripe subscription deletion
  } catch (error) {
    console.error('Error handling Stripe subscription deletion:', error);
  }
}

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL || `http://localhost:${PORT}/webhook`}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down webhook server...');
  server.close(() => {
    console.log('Webhook server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down webhook server...');
  server.close(() => {
    console.log('Webhook server stopped');
    process.exit(0);
  });
});

module.exports = app;
