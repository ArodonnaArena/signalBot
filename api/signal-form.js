// Simple web form for posting signals
export default function handler(req, res) {
  if (req.method === 'GET') {
    // Return HTML form for posting signals
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>ArodonnaSignals - Post Signal</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #555; }
        input, select, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
        textarea { height: 80px; resize: vertical; }
        button { background: #007bff; color: white; padding: 12px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; width: 100%; }
        button:hover { background: #0056b3; }
        .market-type { display: flex; gap: 20px; }
        .market-type label { margin-bottom: 0; }
        .result { margin-top: 20px; padding: 15px; border-radius: 5px; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 Post Trading Signal</h1>
        <form id="signalForm">
          
          <div class="form-group">
            <label>Market Type:</label>
            <div class="market-type">
              <label><input type="radio" name="market_type" value="crypto" checked> ₿ Crypto</label>
              <label><input type="radio" name="market_type" value="forex"> 💱 Forex</label>
            </div>
          </div>
          
          <div class="form-group">
            <label>Signal Type:</label>
            <select name="signal_type" required>
              <option value="long">📈 LONG (Buy)</option>
              <option value="short">📉 SHORT (Sell)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Trading Pair:</label>
            <input type="text" name="pair" placeholder="e.g., BTC/USDT or EUR/USD" required>
          </div>
          
          <div class="form-group">
            <label>Entry Price:</label>
            <input type="number" name="entry_price" step="0.00000001" placeholder="e.g., 73500.00" required>
          </div>
          
          <div class="form-group">
            <label>Stop Loss:</label>
            <input type="number" name="stop_loss" step="0.00000001" placeholder="e.g., 71200.00" required>
          </div>
          
          <div class="form-group">
            <label>Take Profit:</label>
            <input type="number" name="take_profit" step="0.00000001" placeholder="e.g., 76800.00" required>
          </div>
          
          <div class="form-group">
            <label>Confidence Level (%):</label>
            <input type="number" name="confidence_level" min="1" max="100" value="75" required>
          </div>
          
          <div class="form-group">
            <label>Analysis/Reasoning:</label>
            <textarea name="reasoning" placeholder="Why this signal? Technical analysis, market conditions, etc."></textarea>
          </div>
          
          <div class="form-group">
            <label>
              <input type="checkbox" name="is_premium" checked> Premium Signal (unchecked = free signal)
            </label>
          </div>
          
          <div class="form-group">
            <label>Admin Token:</label>
            <input type="password" name="admin_token" placeholder="Enter admin token" required>
          </div>
          
          <button type="submit">📤 Post Signal</button>
        </form>
        
        <div id="result"></div>
      </div>
      
      <script>
        document.getElementById('signalForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());
          data.is_premium = formData.has('is_premium');
          
          try {
            const response = await fetch('/api/admin-signals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            
            const result = await response.json();
            const resultDiv = document.getElementById('result');
            
            if (response.ok) {
              resultDiv.innerHTML = '<div class="result success">✅ Signal posted successfully!</div>';
              e.target.reset();
            } else {
              resultDiv.innerHTML = '<div class="result error">❌ Error: ' + result.error + '</div>';
            }
          } catch (error) {
            document.getElementById('result').innerHTML = '<div class="result error">❌ Network error</div>';
          }
        });
      </script>
    </body>
    </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
