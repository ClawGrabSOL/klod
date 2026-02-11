require('dotenv').config();

module.exports = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY,
  
  // RPC
  rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  rpcWss: process.env.RPC_WSS || 'wss://api.mainnet-beta.solana.com',
  
  // Trading
  tradeAmountSol: parseFloat(process.env.TRADE_AMOUNT_SOL) || 0.04,
  maxPositions: parseInt(process.env.MAX_POSITIONS) || 10,
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 50,
  takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 100,
  maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS) || 500, // 5%
  
  // Risk
  maxDailyLossSol: parseFloat(process.env.MAX_DAILY_LOSS_SOL) || 0.3,
  minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL) || 5,
  
  // Server
  port: parseInt(process.env.PORT) || 3000,
  
  // Constants
  LAMPORTS_PER_SOL: 1_000_000_000,
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
};
