const { PublicKey, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const config = require('./config');
const wallet = require('./wallet');
const db = require('./db');
const risk = require('./risk');

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

async function getQuote(inputMint, outputMint, amount) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: config.maxSlippageBps.toString(),
  });

  const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.statusText}`);
  }
  return response.json();
}

async function executeSwap(quoteResponse) {
  const connection = wallet.getConnection();
  const keypair = wallet.getKeypair();
  
  if (!keypair) {
    throw new Error('Wallet not initialized');
  }

  // Get swap transaction
  const swapResponse = await fetch(JUPITER_SWAP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!swapResponse.ok) {
    throw new Error(`Jupiter swap failed: ${swapResponse.statusText}`);
  }

  const { swapTransaction } = await swapResponse.json();
  
  // Deserialize and sign
  const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([keypair]);

  // Send transaction
  const rawTransaction = transaction.serialize();
  const txSignature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 3,
  });

  console.log(`📤 Transaction sent: ${txSignature}`);

  // Wait for confirmation
  const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');
  
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return txSignature;
}

async function buy(tokenAddress, tokenSymbol, tokenName, reason) {
  // Risk check
  const canTrade = await risk.canTrade();
  if (!canTrade.allowed) {
    console.log(`⛔ Trade blocked: ${canTrade.reason}`);
    return { success: false, reason: canTrade.reason };
  }

  const amountLamports = Math.floor(config.tradeAmountSol * config.LAMPORTS_PER_SOL);

  try {
    console.log(`🛒 Buying ${tokenSymbol || tokenAddress.slice(0, 8)} for ${config.tradeAmountSol} SOL...`);

    // Get quote: SOL -> Token
    const quote = await getQuote(config.SOL_MINT, tokenAddress, amountLamports);
    
    const outAmount = parseInt(quote.outAmount);
    const pricePerToken = config.tradeAmountSol / (outAmount / Math.pow(10, quote.outputMint?.decimals || 9));

    // Record pending trade
    db.insertTrade.run(
      tokenAddress,
      tokenSymbol,
      tokenName,
      'BUY',
      config.tradeAmountSol,
      outAmount,
      pricePerToken,
      null, // tx signature will be updated
      'pending',
      reason
    );

    // Execute swap
    const txSignature = await executeSwap(quote);
    
    // Update trade with signature
    db.updateTradeStatus.run('confirmed', txSignature);

    // Create position
    db.insertPosition.run(
      tokenAddress,
      tokenSymbol,
      tokenName,
      pricePerToken,
      outAmount,
      config.tradeAmountSol,
      reason
    );

    // Update daily stats
    db.upsertDailyStats.run(1, 0, 0, 0, config.tradeAmountSol);

    console.log(`✅ Buy successful! TX: ${txSignature}`);
    
    return {
      success: true,
      txSignature,
      amountTokens: outAmount,
      pricePerToken,
    };
  } catch (err) {
    console.error(`❌ Buy failed: ${err.message}`);
    db.insertTrade.run(
      tokenAddress,
      tokenSymbol,
      tokenName,
      'BUY',
      config.tradeAmountSol,
      0,
      0,
      null,
      'failed',
      `Failed: ${err.message}`
    );
    return { success: false, reason: err.message };
  }
}

async function sell(tokenAddress, reason) {
  const position = db.getPosition.get(tokenAddress);
  if (!position) {
    console.log(`⚠️ No open position for ${tokenAddress}`);
    return { success: false, reason: 'No position found' };
  }

  try {
    console.log(`💰 Selling ${position.token_symbol || tokenAddress.slice(0, 8)}...`);

    // Get token balance
    const tokenBalance = await wallet.getTokenBalance(tokenAddress);
    if (tokenBalance <= 0) {
      db.closePosition.run(reason, -100, tokenAddress); // Mark as total loss
      return { success: false, reason: 'No tokens to sell' };
    }

    const tokenBalanceLamports = Math.floor(tokenBalance * Math.pow(10, 9)); // Assuming 9 decimals

    // Get quote: Token -> SOL
    const quote = await getQuote(tokenAddress, config.SOL_MINT, tokenBalanceLamports);
    
    const outAmountSol = parseInt(quote.outAmount) / config.LAMPORTS_PER_SOL;
    const pnl = outAmountSol - position.amount_sol_spent;
    const pnlPercent = (pnl / position.amount_sol_spent) * 100;

    // Execute swap
    const txSignature = await executeSwap(quote);

    // Record trade
    db.insertTrade.run(
      tokenAddress,
      position.token_symbol,
      position.token_name,
      'SELL',
      outAmountSol,
      tokenBalance,
      outAmountSol / tokenBalance,
      txSignature,
      'confirmed',
      reason
    );

    // Close position
    db.closePosition.run(reason, pnlPercent, tokenAddress);

    // Update stats
    const isWin = pnl > 0;
    db.upsertDailyStats.run(1, isWin ? 1 : 0, isWin ? 0 : 1, pnl, outAmountSol);

    // Record win/loss for risk management
    if (pnl < 0) {
      risk.recordLoss(Math.abs(pnl));
    } else {
      risk.recordWin(pnl);
    }

    console.log(`✅ Sell successful! PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPercent.toFixed(1)}%)`);

    return {
      success: true,
      txSignature,
      amountSol: outAmountSol,
      pnl,
      pnlPercent,
    };
  } catch (err) {
    console.error(`❌ Sell failed: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

async function checkPositions() {
  const positions = db.getOpenPositions.all();
  
  for (const position of positions) {
    try {
      // Get current price via quote
      const quote = await getQuote(
        config.SOL_MINT,
        position.token_address,
        config.LAMPORTS_PER_SOL * 0.001 // Check with small amount
      );
      
      const currentPrice = 0.001 / (parseInt(quote.outAmount) / Math.pow(10, 9));
      const pnlPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
      
      // Update position
      db.updatePositionPrice.run(currentPrice, pnlPercent, position.token_address);

      // Check stop loss
      if (risk.shouldStopLoss(position.entry_price, currentPrice)) {
        console.log(`🛑 Stop loss triggered for ${position.token_symbol}`);
        await sell(position.token_address, 'Stop loss triggered');
        continue;
      }

      // Check take profit
      if (risk.shouldTakeProfit(position.entry_price, currentPrice)) {
        console.log(`🎯 Take profit triggered for ${position.token_symbol}`);
        await sell(position.token_address, 'Take profit triggered');
        continue;
      }

    } catch (err) {
      console.error(`Error checking position ${position.token_symbol}: ${err.message}`);
    }
  }
}

module.exports = {
  buy,
  sell,
  checkPositions,
  getQuote,
};
