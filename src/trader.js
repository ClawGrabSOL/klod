const { VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const config = require('./config');
const wallet = require('./wallet');
const db = require('./db');
const risk = require('./risk');

const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

async function buy(tokenAddress, tokenSymbol, tokenName, reason) {
  // Risk check
  const canTrade = await risk.canTrade();
  if (!canTrade.allowed) {
    console.log(`⛔ Trade blocked: ${canTrade.reason}`);
    return { success: false, reason: canTrade.reason };
  }

  const keypair = wallet.getKeypair();
  const connection = wallet.getConnection();
  
  if (!keypair) {
    return { success: false, reason: 'Wallet not initialized' };
  }

  try {
    console.log(`🛒 Buying ${tokenSymbol || tokenAddress.slice(0, 8)} for ${config.tradeAmountSol} SOL...`);

    // Get transaction from PumpPortal
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        publicKey: keypair.publicKey.toBase58(),
        action: 'buy',
        mint: tokenAddress,
        amount: config.tradeAmountSol.toString(),
        denominatedInSol: 'true',
        slippage: (config.maxSlippageBps / 100).toString(),
        priorityFee: '0.0005',
        pool: 'pump'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpPortal API failed: ${errorText}`);
    }

    // Get the transaction bytes
    const txData = await response.arrayBuffer();
    
    // Deserialize and sign
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([keypair]);

    // Send transaction
    const txSignature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    console.log(`📤 Transaction sent: ${txSignature}`);

    // Record pending trade
    db.insertTrade.run(
      tokenAddress,
      tokenSymbol,
      tokenName,
      'BUY',
      config.tradeAmountSol,
      0, // tokens amount unknown until confirmed
      0,
      txSignature,
      'pending',
      reason
    );

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');
    
    if (confirmation.value.err) {
      db.updateTradeStatus.run('failed', txSignature);
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    // Update trade status
    db.updateTradeStatus.run('confirmed', txSignature);

    // Create position
    db.insertPosition.run(
      tokenAddress,
      tokenSymbol,
      tokenName,
      0, // entry price - will update
      0, // amount tokens - will update
      config.tradeAmountSol,
      reason
    );

    // Update daily stats
    db.upsertDailyStats.run(1, 0, 0, 0, config.tradeAmountSol);

    console.log(`✅ Buy confirmed! TX: https://solscan.io/tx/${txSignature}`);
    
    return {
      success: true,
      txSignature,
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

  const keypair = wallet.getKeypair();
  const connection = wallet.getConnection();

  if (!keypair) {
    return { success: false, reason: 'Wallet not initialized' };
  }

  try {
    console.log(`💰 Selling ${position.token_symbol || tokenAddress.slice(0, 8)}...`);

    // Get token balance
    const tokenBalance = await wallet.getTokenBalance(tokenAddress);
    if (tokenBalance <= 0) {
      db.closePosition.run(reason, -100, tokenAddress);
      return { success: false, reason: 'No tokens to sell' };
    }

    // Get transaction from PumpPortal - sell all tokens
    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        publicKey: keypair.publicKey.toBase58(),
        action: 'sell',
        mint: tokenAddress,
        amount: Math.floor(tokenBalance).toString(),
        denominatedInSol: 'false',
        slippage: (config.maxSlippageBps / 100).toString(),
        priorityFee: '0.0005',
        pool: 'pump'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpPortal API failed: ${errorText}`);
    }

    const txData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
    tx.sign([keypair]);

    const txSignature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    console.log(`📤 Sell transaction sent: ${txSignature}`);

    // Get balance before to calculate PnL
    const balanceBefore = await wallet.getBalance();

    const confirmation = await connection.confirmTransaction(txSignature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    // Get balance after to calculate PnL
    const balanceAfter = await wallet.getBalance();
    const solReceived = balanceAfter - balanceBefore + 0.0005; // Add back priority fee
    const pnl = solReceived - position.amount_sol_spent;
    const pnlPercent = (pnl / position.amount_sol_spent) * 100;

    // Record trade
    db.insertTrade.run(
      tokenAddress,
      position.token_symbol,
      position.token_name,
      'SELL',
      solReceived,
      tokenBalance,
      solReceived / tokenBalance,
      txSignature,
      'confirmed',
      reason
    );

    // Close position
    db.closePosition.run(reason, pnlPercent, tokenAddress);

    // Update stats
    const isWin = pnl > 0;
    db.upsertDailyStats.run(1, isWin ? 1 : 0, isWin ? 0 : 1, pnl, solReceived);

    if (pnl < 0) {
      risk.recordLoss(Math.abs(pnl));
    } else {
      risk.recordWin(pnl);
    }

    console.log(`✅ Sell confirmed! PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPercent.toFixed(1)}%)`);
    console.log(`   TX: https://solscan.io/tx/${txSignature}`);

    return {
      success: true,
      txSignature,
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
      // Get current token balance value
      const tokenBalance = await wallet.getTokenBalance(position.token_address);
      
      if (tokenBalance <= 0) {
        // Token gone - mark as loss
        db.closePosition.run('Tokens no longer in wallet', -100, position.token_address);
        risk.recordLoss(position.amount_sol_spent);
        continue;
      }

      // For pump.fun tokens, we need to estimate current value
      // This is tricky without a quote API - for now we'll check based on time
      const positionAge = (Date.now() - new Date(position.created_at).getTime()) / 1000 / 60; // minutes
      
      // Auto-sell after 30 minutes to avoid holding too long
      if (positionAge > 30) {
        console.log(`⏰ Position timeout for ${position.token_symbol}`);
        await sell(position.token_address, 'Position timeout (30 min)');
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
};
