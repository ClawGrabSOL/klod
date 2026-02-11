// Check all token balances in wallet
require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('./src/config');

async function checkTokens() {
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const wallet = new PublicKey('Do5yxjtdUqiAk6BUkbfFM6LYMNM2XDRk3T18koAEAuaF');
  
  console.log('Fetching token accounts...\n');
  
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  });
  
  console.log(`Found ${tokenAccounts.value.length} token accounts:\n`);
  
  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed.info;
    const balance = info.tokenAmount.uiAmount;
    if (balance > 0) {
      console.log(`Mint: ${info.mint}`);
      console.log(`Balance: ${balance}`);
      console.log('---');
    }
  }
}

checkTokens().catch(console.error);
