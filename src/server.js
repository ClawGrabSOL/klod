const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./db');
const wallet = require('./wallet');
const risk = require('./risk');
const monitor = require('./monitor');
const trader = require('./trader');

// Write data.json for static hosting (Vercel)
async function writeDataJson() {
  try {
    const balance = await wallet.getBalance();
    const positions = db.getOpenPositions.all();
    const recentTrades = db.getRecentTrades.all(20);
    const stats = db.getStats.all(7);
    
    const data = {
      wallet: {
        address: wallet.getPublicKey(),
        balance,
      },
      positions,
      recentTrades,
      stats,
      risk: risk.getStatus(),
      monitor: monitor.getStatus(),
      config: {
        tradeAmountSol: config.tradeAmountSol,
        maxPositions: config.maxPositions,
        stopLossPercent: config.stopLossPercent,
        takeProfitPercent: config.takeProfitPercent,
      },
      lastUpdate: new Date().toISOString(),
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', 'public', 'data.json'),
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error('Failed to write data.json:', err.message);
  }
}

// Update data.json every 10 seconds
setInterval(writeDataJson, 10000);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    const balance = await wallet.getBalance();
    const positions = db.getOpenPositions.all();
    const recentTrades = db.getRecentTrades.all(20);
    const stats = db.getStats.all(7);
    const riskStatus = risk.getStatus();
    const monitorStatus = monitor.getStatus();

    res.json({
      wallet: {
        address: wallet.getPublicKey(),
        balance,
      },
      positions,
      recentTrades,
      stats,
      risk: riskStatus,
      monitor: monitorStatus,
      config: {
        tradeAmountSol: config.tradeAmountSol,
        maxPositions: config.maxPositions,
        stopLossPercent: config.stopLossPercent,
        takeProfitPercent: config.takeProfitPercent,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all trades
app.get('/api/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const trades = db.getRecentTrades.all(limit);
  res.json(trades);
});

// Get all positions
app.get('/api/positions', (req, res) => {
  const positions = db.getAllPositions.all();
  res.json(positions);
});

// Get stats
app.get('/api/stats', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const stats = db.getStats.all(days);
  res.json(stats);
});

// Manual buy
app.post('/api/buy', async (req, res) => {
  const { tokenAddress } = req.body;
  if (!tokenAddress) {
    return res.status(400).json({ error: 'tokenAddress required' });
  }
  
  const result = await monitor.testBuy(tokenAddress);
  res.json(result);
});

// Manual sell
app.post('/api/sell', async (req, res) => {
  const { tokenAddress } = req.body;
  if (!tokenAddress) {
    return res.status(400).json({ error: 'tokenAddress required' });
  }
  
  const result = await monitor.testSell(tokenAddress);
  res.json(result);
});

// Start/stop monitor
app.post('/api/monitor/start', (req, res) => {
  monitor.start();
  res.json({ status: 'started' });
});

app.post('/api/monitor/stop', (req, res) => {
  monitor.stop();
  res.json({ status: 'stopped' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function startServer() {
  app.listen(config.port, () => {
    console.log(`📊 Journal server running at http://localhost:${config.port}`);
  });
}

module.exports = { app, startServer };
