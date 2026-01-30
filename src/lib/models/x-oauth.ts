/**
 * Social Capital X/Twitter OAuth Model (Tweet Likers Feature)
 *
 * Stores OAuth tokens for X accounts (keyed by `client_id`, typically the X username without @).
 * Tokens are encrypted at rest (AES-256-GCM) and can be refreshed automatically.
 *
 * NOTE: This is intentionally separate from SOCAP OAuth storage so Social Capital
 * tweet analysis can evolve independently.
 */

import crypto from 'crypto';
import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== Encryption Configuration =====

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.OAUTH_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('OAUTH_ENCRYPTION_KEY environment variable is not set');
  }
  // 32 bytes = 64 hex chars
  if (key.length !== 64) {
    throw new Error('OAUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

export function encryptToken(plainToken: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plainToken, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptToken(encryptedToken: string): string {
  const key = getEncryptionKey();
  const parts = encryptedToken.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];

  if (authTag.length !== AUTH_TAG_LENGTH) {
    // Defensive: ensure auth tag is 16 bytes
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ===== Types =====

export interface XOAuth {
  _id?: string;

  /** X username without @ (e.g. "johndoe") */
  client_id: string;

  x_user_id: string;
  x_username: string;
  x_name: string;

  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: Date;
  scopes: string[];

  authorized_at: Date;
  last_refreshed_at: Date | null;
  last_used_at: Date | null;

  status: 'active' | 'expired' | 'revoked';

  created_at: Date;
  updated_at: Date;
}

export interface XOAuthInput {
  client_id: string;
  x_user_id: string;
  x_username: string;
  x_name: string;
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scopes: string[];
}

// ===== Collection =====

export async function getXOAuthCollection(): Promise<Collection<XOAuth>> {
  const db = await getDb();
  return db.collection<XOAuth>('x_oauth');
}

export async function createXOAuthIndexes(): Promise<void> {
  const col = await getXOAuthCollection();
  await col.createIndex({ client_id: 1 }, { unique: true });
  await col.createIndex({ x_user_id: 1 });
  await col.createIndex({ status: 1, token_expires_at: 1 });
}

// ===== CRUD =====

export async function upsertXOAuth(input: XOAuthInput): Promise<XOAuth> {
  const col = await getXOAuthCollection();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expires_in * 1000);

  const result = await col.findOneAndUpdate(
    { client_id: input.client_id },
    {
      $set: {
        x_user_id: input.x_user_id,
        x_username: input.x_username,
        x_name: input.x_name,
        access_token_encrypted: encryptToken(input.access_token),
        refresh_token_encrypted: encryptToken(input.refresh_token),
        token_expires_at: expiresAt,
        scopes: input.scopes,
        status: 'active' as const,
        last_refreshed_at: now,
        updated_at: now,
      },
      $setOnInsert: {
        client_id: input.client_id,
        authorized_at: now,
        last_used_at: null,
        created_at: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return result as XOAuth;
}

export async function getXOAuthByClientId(clientId: string): Promise<XOAuth | null> {
  const col = await getXOAuthCollection();
  return await col.findOne({ client_id: clientId });
}

export async function updateXOAuthTokens(
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<boolean> {
  const col = await getXOAuthCollection();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000);
  const res = await col.updateOne(
    { client_id: clientId },
    {
      $set: {
        access_token_encrypted: encryptToken(accessToken),
        refresh_token_encrypted: encryptToken(refreshToken),
        token_expires_at: expiresAt,
        last_refreshed_at: now,
        status: 'active' as const,
        updated_at: now,
      },
    }
  );
  return res.modifiedCount > 0;
}

export async function updateXOAuthStatus(
  clientId: string,
  status: XOAuth['status']
): Promise<boolean> {
  const col = await getXOAuthCollection();
  const res = await col.updateOne(
    { client_id: clientId },
    { $set: { status, updated_at: new Date() } }
  );
  return res.modifiedCount > 0;
}

export async function updateXOAuthLastUsed(clientId: string): Promise<void> {
  const col = await getXOAuthCollection();
  await col.updateOne(
    { client_id: clientId },
    { $set: { last_used_at: new Date(), updated_at: new Date() } }
  );
}

