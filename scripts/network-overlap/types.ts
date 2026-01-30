/**
 * TypeScript types for the Network Overlap Tool
 */

export interface UserReference {
  username: string;
  user_id: string;
  name: string;
}

export interface SeedUser {
  username: string;
  user_id: string;
  name: string;
  following_count: number;
  following_list: UserReference[];
  synced_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface FollowingIndex {
  followed_user_id: string;
  followed_username: string;
  followed_by: UserReference[];
  overlap_score: number;
  updated_at: Date;
}

export interface UserInfo {
  id: string;
  userName: string;
  name: string;
  followers: number;
  following: number;
  description?: string;
  location?: string;
  isBlueVerified?: boolean;
  createdAt?: string;
}

export interface FollowingUser {
  id: string;
  userName: string;
  name: string;
  followers?: number;
  following?: number;
  description?: string;
}

export interface PaginatedFollowingsResponse {
  followings: FollowingUser[];
  has_next_page: boolean;
  next_cursor?: string;
}

export interface OverlapResult {
  username: string;
  user_id: string;
  overlap_score: number;
  followed_by: UserReference[];
}
