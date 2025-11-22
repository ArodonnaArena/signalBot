require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    console.log('Initializing DB...');
    await db.initDB();

    const userInfo = { id: 9999999, username: 'testuser', first_name: 'Test', last_name: 'User' };
    console.log('Upserting user:', userInfo.id);
    const user = await db.upsertUser(userInfo);
    console.log('User upserted:', user);

    const mockPayment = { invoice_payload: `premium_monthly_${userInfo.id}`, telegram_payment_charge_id: 'mock_charge_123' };
    console.log('Creating subscription from payment...');
    const sub = await db.createSubscriptionFromPayment(userInfo, mockPayment);
    console.log('Subscription created:', sub);

    const active = await db.getActiveSubscription(userInfo.id);
    console.log('Active subscription:', active);

    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
