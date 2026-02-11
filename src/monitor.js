const WebSocket = require('ws');
const fetch = require('node-fetch');
const config = require('./config');
const trader = require('./trader');
const risk = require('./risk');
const db = require('./db');

// Pump.fun WebSocket for new token launches
const PUMPFUN_WS = 'wss://pumpportal.fun/api/data';

// Dexscreener API for token info
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

class Monitor {
  constructor() {
    this.ws = null;
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.processedTokens = new Set();
    this.lastBuyTime = 0;
    this.minBuyIntervalMs = 120000; // Wait 2 MINUTES between buys
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('🔍 Starting token monitor...');
    this.connectPumpFun();
    
    // Start the position checker
    trader.startPositionChecker();
  }

  stop() {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
    }
    console.log('🛑 Monitor stopped');
  }

  connectPumpFun() {
    try {
      this.ws = new WebSocket(PUMPFUN_WS);

      this.ws.on('open', () => {
        console.log('✅ Connected to Pump.fun WebSocket');
        this.reconnectAttempts = 0;
        
        // Subscribe to new token events
        this.ws.send(JSON.stringify({
          method: 'subscribeNewToken',
        }));
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleNewToken(message);
        } catch (err) {
          // Ignore parse errors
        }
      });

      this.ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
      });

      this.ws.on('close', () => {
        console.log('WebSocket closed');
        if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Reconnecting in 5s (attempt ${this.reconnectAttempts})...`);
          setTimeout(() => this.connectPumpFun(), 5000);
        }
      });

    } catch (err) {
      console.error('Failed to connect:', err.message);
    }
  }

  async handleNewToken(message) {
    // Handle pump.fun new token message
    if (!message.mint || !message.signature) return;
    
    const tokenAddress = message.mint;
    
    // Skip if already processed
    if (this.processedTokens.has(tokenAddress)) return;
    this.processedTokens.add(tokenAddress);
    
    // Clean up old processed tokens (keep last 1000)
    if (this.processedTokens.size > 1000) {
      const iterator = this.processedTokens.values();
      for (let i = 0; i < 500; i++) {
        this.processedTokens.delete(iterator.next().value);
      }
    }

    console.log(`\n🆕 New token detected: ${message.name || tokenAddress.slice(0, 8)}`);
    console.log(`   Symbol: ${message.symbol || 'Unknown'}`);
    console.log(`   Address: ${tokenAddress}`);

    // Get more token info
    const tokenData = await this.getTokenInfo(tokenAddress, message);
    
    // Evaluate token
    const evaluation = await risk.evaluateToken(tokenData);
    
    console.log(`   Evaluation: ${evaluation.pass ? '✅ PASS' : '❌ FAIL'} - ${evaluation.reason || `Score: ${evaluation.score}`}`);
    
    if (!evaluation.pass) {
      if (evaluation.reason?.includes('Honeypot') || evaluation.reason?.includes('blacklist')) {
        db.addToBlacklist.run(tokenAddress, evaluation.reason);
      }
      return;
    }

    // Rate limit - don't buy too fast
    const timeSinceLastBuy = Date.now() - this.lastBuyTime;
    if (timeSinceLastBuy < this.minBuyIntervalMs) {
      console.log(`⏳ Rate limited - waiting ${((this.minBuyIntervalMs - timeSinceLastBuy) / 1000).toFixed(0)}s`);
      return;
    }

    // Try to buy
    console.log(`\n🚀 Attempting to buy ${message.symbol || tokenAddress.slice(0, 8)}...`);
    this.lastBuyTime = Date.now();
    
    const result = await trader.buy(
      tokenAddress,
      message.symbol || null,
      message.name || null,
      `New token launch - Score: ${evaluation.score}/4`
    );

    if (result.success) {
      console.log(`✅ Successfully bought ${message.symbol}!`);
    } else {
      console.log(`❌ Buy failed: ${result.reason}`);
    }
  }

  async getTokenInfo(tokenAddress, pumpData = {}) {
    const tokenData = {
      address: tokenAddress,
      symbol: pumpData.symbol || null,
      name: pumpData.name || null,
      liquiditySol: null,
      isHoneypot: null,
      mintDisabled: null,
      freezeDisabled: null,
    };

    try {
      // Try to get info from Dexscreener
      const response = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
      if (response.ok) {
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          tokenData.liquiditySol = pair.liquidity?.usd ? pair.liquidity.usd / 200 : null; // Rough SOL estimate
          tokenData.symbol = tokenData.symbol || pair.baseToken?.symbol;
          tokenData.name = tokenData.name || pair.baseToken?.name;
        }
      }
    } catch (err) {
      // Ignore API errors
    }

    // For pump.fun tokens, assume initial liquidity is bonding curve
    // These typically start with ~2-5 SOL in the bonding curve
    if (pumpData.vSolInBondingCurve) {
      tokenData.liquiditySol = pumpData.vSolInBondingCurve;
    }
    
    // Pump.fun tokens have mint/freeze disabled by default
    if (pumpData.mint) {
      tokenData.mintDisabled = true;
      tokenData.freezeDisabled = true;
    }

    return tokenData;
  }

  // Manual trigger for testing
  async testBuy(tokenAddress) {
    console.log(`\n🧪 Test buy for ${tokenAddress}`);
    const tokenData = await this.getTokenInfo(tokenAddress);
    const evaluation = await risk.evaluateToken(tokenData);
    
    console.log('Token data:', tokenData);
    console.log('Evaluation:', evaluation);
    
    if (!evaluation.pass) {
      return { success: false, evaluation };
    }
    
    return await trader.buy(tokenAddress, tokenData.symbol, tokenData.name, 'Manual test buy');
  }

  // Manual sell
  async testSell(tokenAddress) {
    console.log(`\n🧪 Test sell for ${tokenAddress}`);
    return await trader.sell(tokenAddress, 'Manual sell');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      wsConnected: this.ws?.readyState === WebSocket.OPEN,
      processedTokens: this.processedTokens.size,
    };
  }
}

module.exports = new Monitor();
