require('dotenv').config();
const wallet = require('./src/wallet');
wallet.init();
wallet.getBalance().then(b => console.log('Balance:', b.toFixed(4), 'SOL'));
