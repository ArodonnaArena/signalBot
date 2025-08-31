/**
 * Payment helper functions for Telegram Bot Payments
 */

/**
 * Create invoice payload for Telegram sendInvoice
 * @param {Object} options - Invoice options
 * @param {string} options.title - Product name, 1-32 characters
 * @param {string} options.description - Product description, 1-255 characters
 * @param {string} options.payload - Bot-defined invoice payload, 1-128 bytes
 * @param {string} options.provider_token - Payment provider token
 * @param {Array} options.prices - Price breakdown, array of LabeledPrice
 * @param {string} [options.currency='USD'] - Three-letter ISO 4217 currency code
 * @param {Object} [options.photo] - Product photo
 * @param {boolean} [options.need_name=false] - Pass True if you require the user's full name
 * @param {boolean} [options.need_phone_number=false] - Pass True if you require the user's phone number
 * @param {boolean} [options.need_email=false] - Pass True if you require the user's email address
 * @param {boolean} [options.need_shipping_address=false] - Pass True if you require the user's shipping address
 * @param {boolean} [options.send_phone_number_to_provider=false] - Pass True if the user's phone number should be sent to provider
 * @param {boolean} [options.send_email_to_provider=false] - Pass True if the user's email address should be sent to provider
 * @param {boolean} [options.is_flexible=false] - Pass True if the final price depends on the shipping method
 * @returns {Object} Invoice payload for sendInvoice
 */
function createInvoicePayload({
  title,
  description,
  payload,
  provider_token,
  prices,
  currency = 'USD',
  photo = null,
  need_name = false,
  need_phone_number = false,
  need_email = false,
  need_shipping_address = false,
  send_phone_number_to_provider = false,
  send_email_to_provider = false,
  is_flexible = false
}) {
  // Validate required fields
  if (!title || title.length > 32) {
    throw new Error('Title is required and must be 1-32 characters');
  }
  
  if (!description || description.length > 255) {
    throw new Error('Description is required and must be 1-255 characters');
  }
  
  if (!payload || payload.length > 128) {
    throw new Error('Payload is required and must be 1-128 bytes');
  }
  
  if (!provider_token) {
    throw new Error('Provider token is required');
  }
  
  if (!prices || !Array.isArray(prices) || prices.length === 0) {
    throw new Error('Prices array is required and must not be empty');
  }
  
  // Validate prices
  prices.forEach((price, index) => {
    if (!price.label || !price.amount || typeof price.amount !== 'number') {
      throw new Error(`Price at index ${index} must have label and numeric amount`);
    }
    if (price.amount <= 0) {
      throw new Error(`Price amount at index ${index} must be positive`);
    }
  });
  
  const invoicePayload = {
    title,
    description,
    payload,
    provider_token,
    currency,
    prices,
    need_name,
    need_phone_number,
    need_email,
    need_shipping_address,
    send_phone_number_to_provider,
    send_email_to_provider,
    is_flexible
  };
  
  // Add photo if provided
  if (photo) {
    if (photo.url) {
      invoicePayload.photo_url = photo.url;
    }
    if (photo.size) {
      invoicePayload.photo_size = photo.size;
    }
    if (photo.width) {
      invoicePayload.photo_width = photo.width;
    }
    if (photo.height) {
      invoicePayload.photo_height = photo.height;
    }
  }
  
  return invoicePayload;
}

/**
 * Create subscription invoice
 * @param {string} userId - User ID for payload
 * @param {string} plan - Subscription plan (monthly, yearly)
 * @returns {Object} Invoice payload
 */
function createSubscriptionInvoice(userId, plan) {
  const plans = {
    monthly: {
      title: 'Premium Signals - Monthly',
      description: 'Access to private channel with 3-5 premium crypto signals per week',
      price: 2500 // $25.00 in cents
    },
    yearly: {
      title: 'Premium Signals - Yearly',
      description: 'Annual access with 2 months free! Private channel + premium signals',
      price: 25000 // $250.00 in cents
    }
  };
  
  if (!plans[plan]) {
    throw new Error(`Invalid subscription plan: ${plan}`);
  }
  
  const planData = plans[plan];
  
  return createInvoicePayload({
    title: planData.title,
    description: planData.description,
    payload: `premium_${plan}_${userId}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN,
    prices: [{ label: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Subscription`, amount: planData.price }]
  });
}

/**
 * Create product invoice
 * @param {string} userId - User ID for payload
 * @param {string} productSku - Product SKU
 * @returns {Object} Invoice payload
 */
function createProductInvoice(userId, productSku) {
  const products = {
    'crypto-ebook': {
      title: 'Crypto Trading Masterclass eBook',
      description: 'Complete guide to crypto trading strategies and risk management',
      price: 1900 // $19.00 in cents
    },
    'advanced-course': {
      title: 'Advanced Trading Course',
      description: '8-week comprehensive crypto trading course with live sessions',
      price: 9900 // $99.00 in cents
    },
    'one-on-one': {
      title: '1-on-1 Trading Consultation',
      description: '60-minute personal consultation with expert trader',
      price: 19900 // $199.00 in cents
    }
  };
  
  if (!products[productSku]) {
    throw new Error(`Invalid product SKU: ${productSku}`);
  }
  
  const product = products[productSku];
  
  return createInvoicePayload({
    title: product.title,
    description: product.description,
    payload: `${productSku}_${userId}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN,
    prices: [{ label: product.title, amount: product.price }]
  });
}

/**
 * Parse payment payload to extract information
 * @param {string} payload - Invoice payload from successful payment
 * @returns {Object} Parsed payload information
 */
function parsePaymentPayload(payload) {
  try {
    const parts = payload.split('_');
    
    if (parts.length < 2) {
      throw new Error('Invalid payload format');
    }
    
    const type = parts[0];
    const userId = parts[parts.length - 1];
    
    if (type === 'premium') {
      const plan = parts[1];
      return {
        type: 'subscription',
        plan: plan,
        userId: userId
      };
    } else {
      // Product purchase
      const productSku = parts.slice(0, -1).join('_');
      return {
        type: 'product',
        productSku: productSku,
        userId: userId
      };
    }
  } catch (error) {
    console.error('Error parsing payment payload:', error);
    return null;
  }
}

/**
 * Format price for display
 * @param {number} priceInCents - Price in cents
 * @param {string} currency - Currency code
 * @returns {string} Formatted price string
 */
function formatPrice(priceInCents, currency = 'USD') {
  const price = priceInCents / 100;
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(price);
}

/**
 * Calculate subscription expiry date
 * @param {string} plan - Subscription plan
 * @param {Date} startDate - Start date
 * @returns {Date} Expiry date
 */
function calculateSubscriptionExpiry(plan, startDate = new Date()) {
  const expiryDate = new Date(startDate);
  
  switch (plan) {
    case 'monthly':
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      break;
    case 'yearly':
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      break;
    default:
      throw new Error(`Invalid subscription plan: ${plan}`);
  }
  
  return expiryDate;
}

/**
 * Validate payment amount
 * @param {number} expectedAmount - Expected amount in cents
 * @param {number} receivedAmount - Received amount in cents
 * @param {number} tolerance - Tolerance for amount validation (default: 0)
 * @returns {boolean} Whether amounts match within tolerance
 */
function validatePaymentAmount(expectedAmount, receivedAmount, tolerance = 0) {
  const difference = Math.abs(expectedAmount - receivedAmount);
  return difference <= tolerance;
}

/**
 * Check if user has active subscription
 * @param {Date} expiryDate - Subscription expiry date
 * @returns {boolean} Whether subscription is active
 */
function isSubscriptionActive(expiryDate) {
  if (!expiryDate) return false;
  return new Date(expiryDate) > new Date();
}

/**
 * Get days remaining in subscription
 * @param {Date} expiryDate - Subscription expiry date
 * @returns {number} Days remaining (negative if expired)
 */
function getSubscriptionDaysRemaining(expiryDate) {
  if (!expiryDate) return 0;
  
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

module.exports = {
  createInvoicePayload,
  createSubscriptionInvoice,
  createProductInvoice,
  parsePaymentPayload,
  formatPrice,
  calculateSubscriptionExpiry,
  validatePaymentAmount,
  isSubscriptionActive,
  getSubscriptionDaysRemaining
};
