const wallet = require('./wallet');
const monitor = require('./monitor');
const { startServer } = require('./server');
const config = require('./config');

async function main() {
  console.log('');
  console.log('  ██╗  ██╗██╗      ██████╗ ██████╗ ');
  console.log('  ██║ ██╔╝██║     ██╔═══██╗██╔══██╗');
  console.log('  █████╔╝ ██║     ██║   ██║██║  ██║');
  console.log('  ██╔═██╗ ██║     ██║   ██║██║  ██║');
  console.log('  ██║  ██╗███████╗╚██████╔╝██████╔╝');
  console.log('  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝ ');
  console.log('');
  console.log('  Solana Trading Agent');
  console.log('');

  // Initialize wallet
  const { connection } = wallet.init();
  
  if (!config.privateKey) {
    console.log('⚠️  No private key configured!');
    console.log('');
    console.log('To get started:');
    console.log('1. Copy .env.example to .env');
    console.log('2. Add your wallet private key');
    console.log('3. Restart the bot');
    console.log('');
    console.log('For testing, here\'s a new wallet you can fund:');
    const newWallet = wallet.generateWallet();
    console.log(`   Public Key: ${newWallet.publicKey}`);
    console.log(`   Private Key: ${newWallet.privateKey}`);
    console.log('');
    console.log('Starting journal server in read-only mode...');
    startServer();
    return;
  }

  // Check balance
  const balance = await wallet.getBalance();
  console.log(`💰 Wallet: ${wallet.getPublicKey()}`);
  console.log(`💵 Balance: ${balance.toFixed(4)} SOL`);
  console.log('');

  if (balance < config.tradeAmountSol) {
    console.log('⚠️  Insufficient balance for trading!');
    console.log(`   Need at least ${config.tradeAmountSol} SOL, have ${balance.toFixed(4)} SOL`);
    console.log('');
    console.log('Starting journal server in read-only mode...');
    startServer();
    return;
  }

  // Print config
  console.log('⚙️  Configuration:');
  console.log(`   Trade amount: ${config.tradeAmountSol} SOL`);
  console.log(`   Max positions: ${config.maxPositions}`);
  console.log(`   Stop loss: ${config.stopLossPercent}%`);
  console.log(`   Take profit: ${config.takeProfitPercent}%`);
  console.log(`   Max daily loss: ${config.maxDailyLossSol} SOL`);
  console.log('');

  // Start server
  startServer();
  
  // Start monitor
  console.log('');
  console.log('🚀 Starting token monitor...');
  console.log('   Watching for new Pump.fun launches...');
  console.log('');
  
  monitor.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    monitor.stop();
    process.exit(0);
  });
}

main().catch(console.error);
