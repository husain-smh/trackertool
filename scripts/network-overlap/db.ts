/**
 * MongoDB connection for the network_overlap database
 */

import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your MONGODB_URI to .env file');
}

const uri = process.env.MONGODB_URI;
const isLocalMongo = uri?.includes('localhost') || uri?.includes('127.0.0.1') || uri?.includes('mongodb://localhost');

const options = {
  ...(isLocalMongo ? {} : { tls: true, tlsAllowInvalidCertificates: false }),
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
let dbPromise: Promise<Db> | undefined;
let connectionTimestamp = 0;
const CONNECTION_MAX_AGE = 5 * 60 * 1000; // 5 minutes

function isConnectionStale(): boolean {
  return Date.now() - connectionTimestamp > CONNECTION_MAX_AGE;
}

function createConnection(): void {
  console.log('🔄 Creating fresh MongoDB connection to network_overlap...');
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
  dbPromise = clientPromise.then((client) => client.db('network_overlap'));
  connectionTimestamp = Date.now();
}

if (process.env.NODE_ENV === 'development') {
  const globalWithMongo = global as typeof globalThis & {
    _networkOverlapClientPromise?: Promise<MongoClient>;
    _networkOverlapDbPromise?: Promise<Db>;
    _networkOverlapConnectionTimestamp?: number;
  };

  if (!globalWithMongo._networkOverlapClientPromise || !globalWithMongo._networkOverlapConnectionTimestamp ||
      Date.now() - globalWithMongo._networkOverlapConnectionTimestamp > CONNECTION_MAX_AGE) {
    console.log('🔄 Refreshing stale MongoDB connection in development...');
    client = new MongoClient(uri, options);
    globalWithMongo._networkOverlapClientPromise = client.connect();
    globalWithMongo._networkOverlapDbPromise = globalWithMongo._networkOverlapClientPromise.then(
      (client) => client.db('network_overlap')
    );
    globalWithMongo._networkOverlapConnectionTimestamp = Date.now();
  }
  clientPromise = globalWithMongo._networkOverlapClientPromise;
  dbPromise = globalWithMongo._networkOverlapDbPromise!;
  connectionTimestamp = globalWithMongo._networkOverlapConnectionTimestamp;
} else {
  createConnection();
}

export async function getDb(): Promise<Db> {
  if (isConnectionStale() && process.env.NODE_ENV !== 'development') {
    console.log('⚠️ Connection is stale, refreshing...');
    createConnection();
  }

  try {
    return await dbPromise!;
  } catch (error) {
    console.error('❌ MongoDB connection failed, retrying...', error);
    createConnection();
    return await dbPromise!;
  }
}

export async function disconnect(): Promise<void> {
  try {
    const clientInstance = await clientPromise;
    await clientInstance.close();
    console.log('🔌 MongoDB connection closed');
  } catch (error) {
    console.warn('⚠️ Error closing MongoDB connection:', error);
  }
}

export { clientPromise };
export default dbPromise!;
