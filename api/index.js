// Vercel serverless function for root route
export default function handler(req, res) {
  res.status(200).json({
    name: "ArodonnaSignals Bot",
    description: "Telegram bot for crypto & forex trading signals",
    status: "active",
    bot: "@ArodonnaSignalsBot",
    markets: ["crypto", "forex"],
    endpoints: {
      webhook: "/webhook",
      health: "/health",
      admin_signals: "/admin/signals"
    },
    instructions: [
      "1. Open Telegram and search for @ArodonnaSignalsBot",
      "2. Send /start to begin",
      "3. Choose your preferred market (crypto/forex/both)", 
      "4. Use /free for sample signals"
    ],
    admin_note: "Visit /admin/signals to post new signals",
    timestamp: new Date().toISOString()
  });
}
