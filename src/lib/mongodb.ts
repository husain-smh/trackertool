import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your MONGODB_URI to .env file');
}

const uri = process.env.MONGODB_URI;
// Determine if we're connecting to local MongoDB or Atlas
const isLocalMongo = uri?.includes('localhost') || uri?.includes('127.0.0.1') || uri?.includes('mongodb://localhost');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second between retries

const options = {
  // Only use TLS for Atlas connections, not local MongoDB
  ...(isLocalMongo ? {} : { tls: true, tlsAllowInvalidCertificates: false }),
  // Increased timeouts for Vercel serverless cold starts
  serverSelectionTimeoutMS: 15000, // Increased from 5s → 15s for cold starts
  socketTimeoutMS: 45000,          // Increased from 30s → 45s
  connectTimeoutMS: 15000,         // Increased from 5s → 15s for cold starts
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 60000,            // Increased from 30s → 60s
  retryWrites: true,
  retryReads: true,
  // Heartbeat to detect connection issues
  heartbeatFrequencyMS: 10000,
};

let client: MongoClient;
let connectionTimestamp = 0;
const CONNECTION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

// Helper function to check if connection is stale
function isConnectionStale(): boolean {
  return Date.now() - connectionTimestamp > CONNECTION_MAX_AGE;
}

// Helper function to create fresh connection
function createConnection(): Promise<MongoClient> {
  console.log('🔄 Creating fresh MongoDB connection...');
  client = new MongoClient(uri, options);
  connectionTimestamp = Date.now();
  return client.connect();
}

// Initialize clientPromise based on environment
const globalWithMongo = global as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
  _mongoConnectionTimestamp?: number;
};

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!globalWithMongo._mongoClientPromise || !globalWithMongo._mongoConnectionTimestamp || 
      Date.now() - (globalWithMongo._mongoConnectionTimestamp || 0) > CONNECTION_MAX_AGE) {
    console.log('🔄 Refreshing stale MongoDB connection in development...');
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
    globalWithMongo._mongoConnectionTimestamp = Date.now();
  }
  // At this point, _mongoClientPromise is guaranteed to exist
  clientPromise = globalWithMongo._mongoClientPromise || createConnection();
  connectionTimestamp = globalWithMongo._mongoConnectionTimestamp || Date.now();
} else {
  // In production mode, create new connection with pooling
  clientPromise = createConnection();
}

// Helper to sleep for a given duration
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to refresh the connection
function refreshConnection(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    const globalWithMongo = global as typeof globalThis & {
      _mongoClientPromise?: Promise<MongoClient>;
      _mongoConnectionTimestamp?: number;
    };
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
    globalWithMongo._mongoConnectionTimestamp = Date.now();
    clientPromise = globalWithMongo._mongoClientPromise;
    connectionTimestamp = Date.now();
  } else {
    clientPromise = createConnection();
  }
  return clientPromise;
}

// Fast client getter - skips ping for performance on serverless
// The MongoDB driver handles reconnection automatically
async function getClientFast(): Promise<MongoClient> {
  // Check for stale connection in both dev and production
  if (isConnectionStale()) {
    console.log('⚠️ Connection is stale, refreshing...');
    refreshConnection();
  }
  
  try {
    return await clientPromise;
  } catch (error) {
    // Only refresh on actual connection errors
    console.error('❌ MongoDB connection error, refreshing...', error);
    refreshConnection();
    return await clientPromise;
  }
}

// Wrapper function to get client with automatic stale connection refresh and retry logic
// Use this for critical operations that need guaranteed connection
async function getClient(): Promise<MongoClient> {
  // Check for stale connection in both dev and production
  if (isConnectionStale()) {
    console.log('⚠️ Connection is stale, refreshing...');
    refreshConnection();
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const clientInstance = await clientPromise;
      // Only ping in development - skip in production for speed
      // The MongoDB driver handles reconnection automatically
      if (process.env.NODE_ENV === 'development') {
        await clientInstance.db().admin().ping();
      }
      if (attempt > 1) {
        console.log(`✅ MongoDB connected successfully on attempt ${attempt}`);
      }
      return clientInstance;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;
      
      console.error(`❌ MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed:`, errorMessage);
      
      // Provide helpful error message for common issues (only on first attempt)
      if (attempt === 1) {
        if (errorMessage.includes('timeout') || errorMessage.includes('MongoServerSelectionError')) {
          if (isLocalMongo) {
            console.error('💡 Tip: Make sure MongoDB is running locally. Try: mongod or brew services start mongodb-community');
          } else {
            console.error('💡 Tip: Check your MongoDB Atlas connection string and IP whitelist settings.');
          }
        }
      }
      
      // If we have more retries, wait and create a fresh connection
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * attempt; // Linear backoff: 1s, 2s, 3s
        console.log(`🔄 Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        refreshConnection();
      }
    }
  }
  
  // All retries exhausted
  throw new Error(`MongoDB connection failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}. Please check your connection.`);
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
// This maintains backward compatibility while providing better connection management
export default clientPromise;

// Export the smart client getter for better connection management
// - getClient: Standard getter with stale check (ping only in dev mode)
// - getClientFast: Ultra-fast getter, no ping, minimal overhead for serverless
export { getClient, getClientFast };

/**
 * Gracefully disconnect from MongoDB.
 * 
 * IMPORTANT: Call this at the end of CLI scripts (not in web server contexts)
 * to ensure the Node.js process can exit cleanly. Without this, the connection
 * pool keeps the event loop alive indefinitely.
 * 
 * Usage in scripts:
 *   await disconnect();
 *   process.exit(0);
 */
async function disconnect(): Promise<void> {
  try {
    const clientInstance = await clientPromise;
    await clientInstance.close();
    console.log('🔌 MongoDB connection closed');
  } catch (error) {
    // Ignore errors during disconnect - we're shutting down anyway
    console.warn('⚠️ Error closing MongoDB connection:', error);
  }
}

export { disconnect };

