// Force sell all open positions
require('dotenv').config();
const wallet = require('./src/wallet');
const trader = require('./src/trader');
const db = require('./src/db');

async function sellAll() {
  wallet.init();
  
  const positions = db.getOpenPositions.all();
  console.log(`Found ${positions.length} open positions to sell...`);
  
  for (const pos of positions) {
    console.log(`\nSelling ${pos.token_symbol || pos.token_address.slice(0, 8)}...`);
    const result = await trader.sell(pos.token_address, 'Manual sell - closing all');
    console.log(result.success ? `✅ Sold! PnL: ${result.pnl?.toFixed(4) || '?'} SOL` : `❌ Failed: ${result.reason}`);
    await new Promise(r => setTimeout(r, 2000)); // Wait between sells
  }
  
  const balance = await wallet.getBalance();
  console.log(`\n💰 Final balance: ${balance.toFixed(4)} SOL`);
}

sellAll().catch(console.error);
