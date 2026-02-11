# 🎯 Solana Meme Coin Sniper

Automated trading bot for new Solana meme coin launches with a web-based journal.

## Features

- **Auto-detection**: Monitors Pump.fun for new token launches
- **Risk management**: Stop loss, take profit, daily loss limits, position limits
- **Safety checks**: Liquidity, honeypot, mint/freeze authority checks
- **Journal dashboard**: Live web UI showing all trades, positions, and P&L
- **Small position sizing**: Designed for 0.04 SOL trades (~$8-10)

## Quick Start

1. **Copy config**
   ```bash
   cp .env.example .env
   ```

2. **Add your wallet private key** to `.env`:
   ```
   PRIVATE_KEY=your_base58_private_key_here
   ```

3. **Fund the wallet** with SOL (1 SOL recommended to start)

4. **Run the bot**
   ```bash
   npm start
   ```

5. **Open the journal** at http://localhost:3000

## Configuration

Edit `.env` to customize:

| Setting | Default | Description |
|---------|---------|-------------|
| `TRADE_AMOUNT_SOL` | 0.04 | SOL per trade |
| `MAX_POSITIONS` | 10 | Max open positions |
| `STOP_LOSS_PERCENT` | 50 | Sell if down this % |
| `TAKE_PROFIT_PERCENT` | 100 | Sell if up this % (2x) |
| `MAX_DAILY_LOSS_SOL` | 0.3 | Stop trading if daily loss exceeds |
| `MIN_LIQUIDITY_SOL` | 5 | Minimum liquidity to enter |

## How It Works

1. **Monitor**: WebSocket connection to Pump.fun watches for new token launches
2. **Evaluate**: Each token is scored on safety factors (liquidity, mint disabled, freeze disabled)
3. **Buy**: If it passes evaluation and risk checks, buy with configured amount via Jupiter
4. **Monitor positions**: Every 30s, check open positions for stop loss / take profit triggers
5. **Sell**: Auto-sell when targets hit, or manually via the dashboard

## API Endpoints

- `GET /api/dashboard` - All dashboard data
- `GET /api/trades` - Trade history
- `GET /api/positions` - All positions
- `POST /api/buy` - Manual buy `{ "tokenAddress": "..." }`
- `POST /api/sell` - Manual sell `{ "tokenAddress": "..." }`
- `POST /api/monitor/start` - Start auto-trading
- `POST /api/monitor/stop` - Stop auto-trading

## ⚠️ Risks

- **This is gambling** - Meme coins are extremely volatile
- **Expect losses** - Most tokens go to zero
- **Bot sniping is competitive** - Other bots are faster
- **Rug pulls** - Even with safety checks, you can get rugged
- **Start small** - Don't risk more than you can lose

## Project Structure

```
solana-sniper/
├── src/
│   ├── index.js     # Entry point
│   ├── config.js    # Configuration
│   ├── wallet.js    # Wallet management
│   ├── trader.js    # Buy/sell logic via Jupiter
│   ├── monitor.js   # New token detection
│   ├── risk.js      # Risk management
│   ├── db.js        # SQLite trade history
│   └── server.js    # Journal API server
├── public/
│   └── index.html   # Dashboard UI
├── .env.example     # Config template
└── trades.db        # Trade history (created on first run)
```

## License

MIT - Use at your own risk.
