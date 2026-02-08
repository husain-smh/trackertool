import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your MONGODB_URI to .env file');
}

const uri = process.env.MONGODB_URI;
const isLocalMongo = uri?.includes('localhost') || uri?.includes('127.0.0.1') || uri?.includes('mongodb://localhost');

const options = {
  ...(isLocalMongo ? {} : { tls: true, tlsAllowInvalidCertificates: false }),
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000,
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 60000,
  retryWrites: true,
  retryReads: true,
};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;
let tooltrackerDbPromise: Promise<Db> | undefined;
let connectionTimestamp = 0;
const CONNECTION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

function isConnectionStale(): boolean {
  return Date.now() - connectionTimestamp > CONNECTION_MAX_AGE;
}

function createConnection(): void {
  console.log('🔄 Creating fresh MongoDB tooltracker connection...');
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
  tooltrackerDbPromise = clientPromise.then((client) => client.db('tooltracker'));
  connectionTimestamp = Date.now();
}

if (process.env.NODE_ENV === 'development') {
  const globalWithMongo = global as typeof globalThis & {
    _mongoTooltrackerClientPromise?: Promise<MongoClient>;
    _tooltrackerDbPromise?: Promise<Db>;
    _tooltrackerConnectionTimestamp?: number;
  };

  if (!globalWithMongo._mongoTooltrackerClientPromise || !globalWithMongo._tooltrackerConnectionTimestamp ||
      Date.now() - globalWithMongo._tooltrackerConnectionTimestamp > CONNECTION_MAX_AGE) {
    console.log('🔄 Refreshing stale MongoDB tooltracker connection in development...');
    client = new MongoClient(uri, options);
    globalWithMongo._mongoTooltrackerClientPromise = client.connect();
    globalWithMongo._tooltrackerDbPromise = globalWithMongo._mongoTooltrackerClientPromise.then(
      (client) => client.db('tooltracker')
    );
    globalWithMongo._tooltrackerConnectionTimestamp = Date.now();
  }
  clientPromise = globalWithMongo._mongoTooltrackerClientPromise;
  tooltrackerDbPromise = globalWithMongo._tooltrackerDbPromise!;
  connectionTimestamp = globalWithMongo._tooltrackerConnectionTimestamp;
} else {
  createConnection();
}

export async function getDb(): Promise<Db> {
  if (isConnectionStale() && process.env.NODE_ENV !== 'development') {
    console.log('⚠️ Tooltracker connection is stale, refreshing...');
    createConnection();
  }

  try {
    return await tooltrackerDbPromise!;
  } catch (error) {
    console.error('❌ MongoDB tooltracker connection failed, retrying...', error);
    createConnection();
    return await tooltrackerDbPromise!;
  }
}

export { clientPromise };
export default tooltrackerDbPromise!;
