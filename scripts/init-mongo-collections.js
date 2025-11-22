// scripts/init-mongo-collections.js
// Create application collections and indexes in your existing MongoDB database.
// Usage: ensure MONGODB_URI and (optionally) MONGODB_DB_NAME are set in your environment or .env,
// then run: `node scripts/init-mongo-collections.js`

require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Set it in your environment or .env file.');
    process.exit(1);
  }

  const dbName = process.env.MONGODB_DB_NAME || 'signal_bot_db';
  const client = new MongoClient(uri);

  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    const db = client.db(dbName);

    const collections = [
      { name: 'app_users' },
      { name: 'app_subscriptions' },
      { name: 'app_referrals' },
      { name: 'telegram_signal_logs' },
      { name: 'signal_publish_log' }
    ];

    for (const c of collections) {
      const exists = await db.listCollections({ name: c.name }).toArray();
      if (exists.length === 0) {
        console.log(`Creating collection: ${c.name}`);
        await db.createCollection(c.name);
      } else {
        console.log(`Collection already exists: ${c.name}`);
      }
    }

    // Create recommended indexes
    console.log('Creating indexes...');
    await db.collection('app_users').createIndex({ telegram_id: 1 }, { unique: true });
    await db.collection('app_subscriptions').createIndex({ status: 1, expires_at: 1 });
    await db.collection('app_referrals').createIndex({ referrer_telegram_id: 1 });
    await db.collection('telegram_signal_logs').createIndex({ signal_id: 1 });
    // _id is already unique by default; no explicit unique index required

    // Seed publish log entries if missing
    const seed = [
      { _id: 'free', last_published: null },
      { _id: 'premium', last_published: null }
    ];
    for (const s of seed) {
      const exists = await db.collection('signal_publish_log').findOne({ _id: s._id });
      if (!exists) {
        console.log(`Seeding publish log entry: ${s._id}`);
        await db.collection('signal_publish_log').insertOne(s);
      }
    }

    console.log(`App collections and indexes initialized in database: ${dbName}`);
  } catch (err) {
    console.error('Initialization failed:', err);
    process.exitCode = 1;
  } finally {
    try { await client.close(); } catch (e) {}
  }
})();
