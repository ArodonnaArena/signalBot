// Admin interface for posting signals
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// In-memory signal storage (replace with database later)
const signals = [];
const subscribers = new Map(); // telegramId -> preferences

// Signal creation endpoint
export default async function handler(req, res) {
  if (req.method === 'POST' && req.url === '/api/admin-signals') {
    try {
      const { 
        market_type, 
        signal_type, 
        pair, 
        entry_price, 
        stop_loss, 
        take_profit, 
        confidence_level, 
        reasoning, 
        is_premium = true,
        admin_token 
      } = req.body;
      
      // Simple admin authentication
      if (admin_token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      // Validate required fields
      if (!market_type || !signal_type || !pair || !entry_price || !stop_loss || !take_profit) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      // Create signal object
      const signal = {
        id: Date.now(), // Simple ID generation
        market_type,
        signal_type: signal_type.toUpperCase(),
        pair: pair.toUpperCase(),
        entry_price: parseFloat(entry_price),
        stop_loss: parseFloat(stop_loss),
        take_profit: parseFloat(take_profit),
        confidence_level: parseInt(confidence_level) || 75,
        reasoning: reasoning || '',
        is_premium: Boolean(is_premium),
        created_at: new Date().toISOString(),
        status: 'active'
      };
      
      // Store signal
      signals.push(signal);
      
      // Send signal to subscribers
      await sendSignalToSubscribers(signal);
      
      res.status(200).json({
        message: 'Signal created and sent successfully',
        signal: signal
      });
      
    } catch (error) {
      console.error('Error creating signal:', error);
      res.status(500).json({ error: 'Failed to create signal' });
    }
  } else if (req.method === 'GET') {
    // Get recent signals
    res.status(200).json({
      signals: signals.slice(-10), // Last 10 signals
      total: signals.length
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

async function sendSignalToSubscribers(signal) {
  try {
    const marketEmoji = signal.market_type === 'crypto' ? '₿' : '💱';
    const directionEmoji = signal.signal_type === 'LONG' ? '📈' : '📉';
    const premiumText = signal.is_premium ? '💎 **PREMIUM SIGNAL**' : '📈 **FREE SIGNAL**';
    
    const signalMessage = 
      `${premiumText}\n\n` +
      `${marketEmoji} **${signal.market_type.toUpperCase()} SIGNAL** ${directionEmoji}\n\n` +
      `**Pair:** ${signal.pair}\n` +
      `**Direction:** ${signal.signal_type}\n` +
      `**Entry:** ${signal.entry_price}\n` +
      `**Stop Loss:** ${signal.stop_loss}\n` +
      `**Take Profit:** ${signal.take_profit}\n` +
      `**Confidence:** ${signal.confidence_level}%\n\n` +
      (signal.reasoning ? `**Analysis:** ${signal.reasoning}\n\n` : '') +
      `⚠️ *Not financial advice. Trade at your own risk.*\n\n` +
      `*Signal ID: ${signal.id}*`;
    
    // For now, we'll log the signal (in production, send to actual subscribers)
    console.log('Signal created and ready for delivery:', {
      signal_id: signal.id,
      market: signal.market_type,
      pair: signal.pair,
      type: signal.signal_type,
      is_premium: signal.is_premium
    });
    
    // In a real implementation, you would:
    // 1. Get all premium subscribers from database
    // 2. Filter by their market preferences
    // 3. Send the signal to each subscriber
    // 4. Log delivery status
    
    return true;
  } catch (error) {
    console.error('Error sending signal to subscribers:', error);
    return false;
  }
}

// Helper function to format signal for display
function formatSignal(signal) {
  const marketEmoji = signal.market_type === 'crypto' ? '₿' : '💱';
  const directionEmoji = signal.signal_type === 'LONG' ? '📈' : '📉';
  
  return {
    id: signal.id,
    emoji: `${marketEmoji} ${directionEmoji}`,
    title: `${signal.pair} ${signal.signal_type}`,
    entry: signal.entry_price,
    stop: signal.stop_loss,
    target: signal.take_profit,
    confidence: `${signal.confidence_level}%`,
    market: signal.market_type,
    is_premium: signal.is_premium,
    created_at: signal.created_at
  };
}
