const db = require('./src/db');
const positions = db.getOpenPositions.all();
console.log('Open positions:', positions.length);
positions.forEach(p => {
  console.log(`- ${p.token_symbol || p.token_address.slice(0,8)}: ${p.amount_sol_spent} SOL, created: ${p.created_at}`);
});
