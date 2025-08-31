// Vercel serverless function for root route
module.exports = async (req, res) => {
  res.status(200).json({
    name: "ArodonnaSignals Bot",
    description: "Telegram bot for crypto trading signals",
    status: "active",
    bot: "@ArodonnaSignalsBot",
    endpoints: {
      webhook: "/webhook",
      health: "/health"
    },
    instructions: [
      "1. Open Telegram and search for @ArodonnaSignalsBot",
      "2. Send /start to begin",
      "3. Use /free for sample signals"
    ],
    timestamp: new Date().toISOString()
  });
};
