const config = require('./config');
const db = require('./db');
const wallet = require('./wallet');

class RiskManager {
  constructor() {
    this.dailyLoss = 0;
    this.lastResetDate = new Date().toDateString();
  }

  resetDailyIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyLoss = 0;
      this.lastResetDate = today;
      console.log('📅 Daily risk counters reset');
    }
  }

  async canTrade() {
    this.resetDailyIfNeeded();

    // Check daily loss limit
    if (this.dailyLoss >= config.maxDailyLossSol) {
      return { allowed: false, reason: `Daily loss limit reached (${this.dailyLoss.toFixed(4)} SOL)` };
    }

    // Check wallet balance
    const balance = await wallet.getBalance();
    if (balance < config.tradeAmountSol * 1.1) { // 10% buffer for fees
      return { allowed: false, reason: `Insufficient balance (${balance.toFixed(4)} SOL)` };
    }

    // Check max positions
    const openPositions = db.getOpenPositions.all();
    if (openPositions.length >= config.maxPositions) {
      return { allowed: false, reason: `Max positions reached (${openPositions.length}/${config.maxPositions})` };
    }

    return { allowed: true };
  }

  recordLoss(amountSol) {
    this.dailyLoss += amountSol;
    console.log(`📉 Daily loss updated: ${this.dailyLoss.toFixed(4)} SOL`);
  }

  recordWin(amountSol) {
    // Wins don't reduce daily loss tracking (conservative approach)
    console.log(`📈 Win recorded: +${amountSol.toFixed(4)} SOL`);
  }

  shouldStopLoss(entryPrice, currentPrice) {
    const lossPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
    return lossPercent >= config.stopLossPercent;
  }

  shouldTakeProfit(entryPrice, currentPrice) {
    const gainPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    return gainPercent >= config.takeProfitPercent;
  }

  async evaluateToken(tokenData) {
    const checks = [];
    let score = 0;

    // Check if blacklisted
    if (db.isBlacklisted.get(tokenData.address)) {
      return { pass: false, reason: 'Token blacklisted', checks };
    }

    // Already have position?
    const existingPosition = db.getPosition.get(tokenData.address);
    if (existingPosition) {
      return { pass: false, reason: 'Already have position', checks };
    }

    // Minimum liquidity check
    if (tokenData.liquiditySol && tokenData.liquiditySol >= config.minLiquiditySol) {
      checks.push({ name: 'liquidity', pass: true, value: tokenData.liquiditySol });
      score += 1;
    } else {
      checks.push({ name: 'liquidity', pass: false, value: tokenData.liquiditySol || 0 });
    }

    // Not a honeypot (if we have this data)
    if (tokenData.isHoneypot === false) {
      checks.push({ name: 'honeypot', pass: true });
      score += 1;
    } else if (tokenData.isHoneypot === true) {
      checks.push({ name: 'honeypot', pass: false });
      return { pass: false, reason: 'Honeypot detected', checks };
    }

    // Mint authority check
    if (tokenData.mintDisabled) {
      checks.push({ name: 'mintDisabled', pass: true });
      score += 1;
    } else {
      checks.push({ name: 'mintDisabled', pass: false });
    }

    // Freeze authority check
    if (tokenData.freezeDisabled) {
      checks.push({ name: 'freezeDisabled', pass: true });
      score += 1;
    } else {
      checks.push({ name: 'freezeDisabled', pass: false });
    }

    // Must pass liquidity at minimum
    const liquidityCheck = checks.find(c => c.name === 'liquidity');
    if (!liquidityCheck?.pass) {
      return { pass: false, reason: 'Insufficient liquidity', checks };
    }

    // Score threshold (at least 2 checks must pass)
    if (score < 2) {
      return { pass: false, reason: `Low safety score (${score}/4)`, checks };
    }

    return { pass: true, score, checks };
  }

  getStatus() {
    return {
      dailyLoss: this.dailyLoss,
      maxDailyLoss: config.maxDailyLossSol,
      remainingRisk: config.maxDailyLossSol - this.dailyLoss,
    };
  }
}

module.exports = new RiskManager();
