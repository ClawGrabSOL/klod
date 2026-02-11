const bs58 = require('bs58');
console.log('bs58 exports:', Object.keys(bs58));
console.log('bs58 type:', typeof bs58);
console.log('bs58.encode:', typeof bs58.encode);
console.log('bs58.decode:', typeof bs58.decode);
if (bs58.default) {
  console.log('bs58.default.encode:', typeof bs58.default.encode);
}
