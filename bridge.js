const axios = require('axios');
const cron = require('node-cron');
const chalk = require('chalk');
require('dotenv').config();

const BACKEND_URL = 'https://roblox-purchase-backend.vercel.app';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'your-secret-here';

console.log(chalk.cyan('🤖 Roblox Purchase Bridge Started'));
console.log(chalk.gray(`📡 Backend: ${BACKEND_URL}`));

async function processPurchase(queueItem) {
  console.log(chalk.yellow(`\n🛒 Processing #${queueItem.id} - Gamepass: ${queueItem.gamepass_id}`));
  
  try {
    const session = axios.create({
      headers: {
        Cookie: `.ROBLOSECURITY=${queueItem.cookie}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Get CSRF token
    console.log(chalk.gray('  🔑 Fetching CSRF token...'));
    const csrfResponse = await session.post('https://auth.roblox.com/v2/logout');
    const csrfToken = csrfResponse.headers['x-csrf-token'];
    
    if (!csrfToken) {
      throw new Error('Failed to obtain CSRF token - Cookie may be invalid');
    }

    // Get user info
    console.log(chalk.gray('  👤 Fetching user info...'));
    const userInfo = await session.get('https://users.roblox.com/v1/users/authenticated');
    const userId = userInfo.data.id;
    console.log(chalk.green(`  ✅ Authenticated as User ID: ${userId}`));

    // Get gamepass info
    console.log(chalk.gray('  🎮 Fetching gamepass details...'));
    const productInfo = await session.get(
      `https://economy.roblox.com/v1/game-pass/${queueItem.gamepass_id}/product-info`
    );

    // Execute purchase
    console.log(chalk.gray('  💰 Executing purchase...'));
    const purchaseData = {
      expectedCurrency: 1,
      expectedPrice: productInfo.data.Price,
      expectedSellerId: productInfo.data.Creator.Id
    };

    const purchaseResponse = await session.post(
      `https://economy.roblox.com/v1/purchases/products/${productInfo.data.ProductId}`,
      purchaseData,
      { headers: { 'x-csrf-token': csrfToken } }
    );

    // Update backend with success
    await axios.post(
      `${BACKEND_URL}/api/update-purchase`,
      {
        id: queueItem.id,
        status: 'completed',
        userId: userId,
        transactionId: purchaseResponse.data.transactionId || 'completed'
      },
      { headers: { 'x-bridge-token': BRIDGE_SECRET } }
    );

    console.log(chalk.green(`  ✅ Purchase #${queueItem.id} completed!`));

  } catch (error) {
    console.log(chalk.red(`  ❌ Purchase #${queueItem.id} failed: ${error.message}`));
    
    await axios.post(
      `${BACKEND_URL}/api/update-purchase`,
      {
        id: queueItem.id,
        status: 'failed',
        errorMessage: error.response?.data?.errors?.[0]?.message || error.message
      },
      { headers: { 'x-bridge-token': BRIDGE_SECRET } }
    );
  }
}

async function checkPendingPurchases() {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/pending-purchases`, {
      headers: { 'x-bridge-token': BRIDGE_SECRET }
    });

    const pending = response.data;
    
    if (pending.length > 0) {
      console.log(chalk.blue(`\n📋 Found ${pending.length} pending purchase(s)`));
      
      for (const purchase of pending) {
        await processPurchase(purchase);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error(chalk.red('Failed to check pending purchases:'), error.message);
  }
}

// Check immediately on start
checkPendingPurchases();

// Check every 10 seconds
cron.schedule('*/10 * * * * *', () => {
  checkPendingPurchases();
});

console.log(chalk.green('\n✨ Bridge is running and polling for purchases...\n'));
