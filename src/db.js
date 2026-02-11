const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'trades.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_address TEXT NOT NULL,
    token_symbol TEXT,
    token_name TEXT,
    action TEXT NOT NULL, -- 'BUY' or 'SELL'
    amount_sol REAL NOT NULL,
    amount_tokens REAL,
    price_per_token REAL,
    tx_signature TEXT,
    status TEXT DEFAULT 'pending', -- pending, confirmed, failed
    reason TEXT, -- why we entered/exited
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_address TEXT UNIQUE NOT NULL,
    token_symbol TEXT,
    token_name TEXT,
    entry_price REAL,
    amount_tokens REAL,
    amount_sol_spent REAL,
    current_price REAL,
    pnl_percent REAL DEFAULT 0,
    status TEXT DEFAULT 'open', -- open, closed
    entry_reason TEXT,
    exit_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    trades_count INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    total_pnl_sol REAL DEFAULT 0,
    volume_sol REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS token_blacklist (
    token_address TEXT PRIMARY KEY,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Trade functions
const insertTrade = db.prepare(`
  INSERT INTO trades (token_address, token_symbol, token_name, action, amount_sol, amount_tokens, price_per_token, tx_signature, status, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTradeStatus = db.prepare(`
  UPDATE trades SET status = ? WHERE tx_signature = ?
`);

// Position functions
const insertPosition = db.prepare(`
  INSERT INTO positions (token_address, token_symbol, token_name, entry_price, amount_tokens, amount_sol_spent, status, entry_reason)
  VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  ON CONFLICT(token_address) DO UPDATE SET
    amount_sol_spent = amount_sol_spent + excluded.amount_sol_spent,
    entry_reason = excluded.entry_reason
`);

const getOpenPositions = db.prepare(`
  SELECT * FROM positions WHERE status = 'open'
`);

const getPosition = db.prepare(`
  SELECT * FROM positions WHERE token_address = ? AND status = 'open'
`);

const closePosition = db.prepare(`
  UPDATE positions SET status = 'closed', exit_reason = ?, pnl_percent = ?, closed_at = CURRENT_TIMESTAMP
  WHERE token_address = ? AND status = 'open'
`);

const updatePositionPrice = db.prepare(`
  UPDATE positions SET current_price = ?, pnl_percent = ? WHERE token_address = ? AND status = 'open'
`);

// Stats functions
const getTodayStats = db.prepare(`
  SELECT * FROM daily_stats WHERE date = date('now')
`);

const upsertDailyStats = db.prepare(`
  INSERT INTO daily_stats (date, trades_count, wins, losses, total_pnl_sol, volume_sol)
  VALUES (date('now'), ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    trades_count = trades_count + excluded.trades_count,
    wins = wins + excluded.wins,
    losses = losses + excluded.losses,
    total_pnl_sol = total_pnl_sol + excluded.total_pnl_sol,
    volume_sol = volume_sol + excluded.volume_sol
`);

// Blacklist
const isBlacklisted = db.prepare(`
  SELECT 1 FROM token_blacklist WHERE token_address = ?
`);

const addToBlacklist = db.prepare(`
  INSERT OR IGNORE INTO token_blacklist (token_address, reason) VALUES (?, ?)
`);

// Journal queries
const getRecentTrades = db.prepare(`
  SELECT * FROM trades ORDER BY created_at DESC LIMIT ?
`);

const getAllPositions = db.prepare(`
  SELECT * FROM positions ORDER BY created_at DESC
`);

const getStats = db.prepare(`
  SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?
`);

module.exports = {
  db,
  insertTrade,
  updateTradeStatus,
  insertPosition,
  getOpenPositions,
  getPosition,
  closePosition,
  updatePositionPrice,
  getTodayStats,
  upsertDailyStats,
  isBlacklisted,
  addToBlacklist,
  getRecentTrades,
  getAllPositions,
  getStats,
};
