const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const config = require('./config');

let connection = null;
let wallet = null;

function init() {
  connection = new Connection(config.rpcUrl, 'confirmed');
  
  if (config.privateKey) {
    try {
      const decoded = bs58.decode(config.privateKey);
      wallet = Keypair.fromSecretKey(decoded);
      console.log(`Wallet loaded: ${wallet.publicKey.toBase58()}`);
    } catch (err) {
      console.error('Failed to load wallet from private key:', err.message);
    }
  }
  
  return { connection, wallet };
}

async function getBalance() {
  if (!wallet) return 0;
  const balance = await connection.getBalance(wallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

async function getTokenBalance(mintAddress) {
  if (!wallet) return 0;
  
  try {
    const mint = new PublicKey(mintAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { mint }
    );
    
    if (tokenAccounts.value.length === 0) return 0;
    
    return tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
  } catch (err) {
    console.error('Error getting token balance:', err.message);
    return 0;
  }
}

function getPublicKey() {
  return wallet?.publicKey?.toBase58();
}

function getKeypair() {
  return wallet;
}

function getConnection() {
  return connection;
}

// Generate a new wallet (for testing)
function generateWallet() {
  const newWallet = Keypair.generate();
  return {
    publicKey: newWallet.publicKey.toBase58(),
    privateKey: bs58.encode(newWallet.secretKey),
  };
}

module.exports = {
  init,
  getBalance,
  getTokenBalance,
  getPublicKey,
  getKeypair,
  getConnection,
  generateWallet,
};
