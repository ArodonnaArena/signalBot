// Health check endpoint for Vercel
export default function handler(req, res) {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    bot: '@ArodonnaSignalsBot',
    webhook_url: 'https://signal-bot-lyart.vercel.app/webhook',
    environment: 'vercel',
    uptime: process.uptime()
  });
}
