import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your MONGODB_URI to .env file');
}

const uri = process.env.MONGODB_URI;
const options = {
  tls: true,
  tlsAllowInvalidCertificates: false,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 30000,
  retryWrites: true,
  retryReads: true,
};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;
let rankerDbPromise: Promise<Db> | undefined;
let connectionTimestamp = 0;
const CONNECTION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

// Helper function to check if connection is stale
function isConnectionStale(): boolean {
  return Date.now() - connectionTimestamp > CONNECTION_MAX_AGE;
}

// Helper function to create fresh connection
function createConnection(): void {
  console.log('🔄 Creating fresh MongoDB connection...');
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
  rankerDbPromise = clientPromise.then((client) => client.db('twitter_ranker'));
  connectionTimestamp = Date.now();
}

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable
  const globalWithMongo = global as typeof globalThis & {
    _mongoRankerClientPromise?: Promise<MongoClient>;
    _rankerDbPromise?: Promise<Db>;
    _rankerConnectionTimestamp?: number;
  };

  if (!globalWithMongo._mongoRankerClientPromise || !globalWithMongo._rankerConnectionTimestamp || 
      Date.now() - globalWithMongo._rankerConnectionTimestamp > CONNECTION_MAX_AGE) {
    console.log('🔄 Refreshing stale MongoDB connection in development...');
    client = new MongoClient(uri, options);
    globalWithMongo._mongoRankerClientPromise = client.connect();
    globalWithMongo._rankerDbPromise = globalWithMongo._mongoRankerClientPromise.then(
      (client) => client.db('twitter_ranker')
    );
    globalWithMongo._rankerConnectionTimestamp = Date.now();
  }
  clientPromise = globalWithMongo._mongoRankerClientPromise;
  rankerDbPromise = globalWithMongo._rankerDbPromise!;
  connectionTimestamp = globalWithMongo._rankerConnectionTimestamp;
} else {
  // In production/serverless, create new connection each time but with pooling
  createConnection();
}

// Get database with automatic stale connection refresh
export async function getDb(): Promise<Db> {
  if (isConnectionStale() && process.env.NODE_ENV !== 'development') {
    console.log('⚠️ Connection is stale, refreshing...');
    createConnection();
  }
  
  try {
    return await rankerDbPromise!;
  } catch (error) {
    console.error('❌ MongoDB connection failed, retrying...', error);
    // Recreate connection on failure
    createConnection();
    return await rankerDbPromise!;
  }
}

// Export both client and database promises
export { clientPromise };
export default rankerDbPromise!;

