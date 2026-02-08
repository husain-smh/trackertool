'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface Notification {
  id: string;
  tweet_id: string;
  engagement_id: string;
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  generated_text: string;
  edited_text?: string;
  final_text?: string;
  status: 'generated' | 'edited' | 'sent' | 'skipped';
  importance_score: number;
  engager_username: string;
  engager_name: string;
  engager_followers: number;
  generated_at: string;
  edited_at?: string;
  sent_at?: string;
  sent_by?: string;
}

type StatusFilter = 'all' | 'generated' | 'edited' | 'sent' | 'skipped';

export default function NotificationsPage() {
  const params = useParams();
  const router = useRouter();
  const tweetId = params?.tweetId as string;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchNotifications = useCallback(async () => {
    try {
      const statusParam = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const response = await fetch(`/api/monitor-tweet/${tweetId}/notifications${statusParam}`);
      const result = await response.json();

      if (response.ok && result.success) {
        setNotifications(result.notifications);
        setTotal(result.total);
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch notifications');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [tweetId, statusFilter]);

  useEffect(() => {
    if (tweetId) {
      fetchNotifications();
    }
  }, [tweetId, fetchNotifications]);

  const handleEdit = (notification: Notification) => {
    setEditingId(notification.id);
    setEditText(notification.edited_text || notification.generated_text);
  };

  const handleSaveEdit = async (notificationId: string) => {
    try {
      const response = await fetch(
        `/api/monitor-tweet/${tweetId}/notifications/${notificationId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editedText: editText }),
        }
      );

      if (response.ok) {
        setEditingId(null);
        fetchNotifications();
      } else {
        const result = await response.json();
        setError(result.error || 'Failed to save edit');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  };

  const handleSend = async (notificationId: string, editedText?: string) => {
    setSendingId(notificationId);
    try {
      const response = await fetch(`/api/monitor-tweet/${tweetId}/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId, editedText }),
      });

      const result = await response.json();
      if (response.ok && result.success) {
        fetchNotifications();
      } else {
        setError(result.error || 'Failed to send notification');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSendingId(null);
    }
  };

  const handleSkip = async (notificationId: string) => {
    try {
      const response = await fetch(
        `/api/monitor-tweet/${tweetId}/notifications/${notificationId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip: true }),
        }
      );

      if (response.ok) {
        fetchNotifications();
      } else {
        const result = await response.json();
        setError(result.error || 'Failed to skip notification');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'retweet':
        return '🔄';
      case 'reply':
        return '💬';
      case 'quote':
        return '🔁';
      case 'like':
        return '❤️';
      default:
        return '📝';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'generated':
        return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">Generated</span>;
      case 'edited':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">Edited</span>;
      case 'sent':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Sent</span>;
      case 'skipped':
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded-full">Skipped</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading notifications...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="relative z-10">
        <div className="pt-20 pb-8">
          <div className="max-w-7xl mx-auto px-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">Notification Review</h1>
                <p className="text-muted-foreground">
                  Review and send engagement notifications for tweet {tweetId.slice(0, 10)}...
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/monitor/${tweetId}/engagers`}
                  className="bg-card hover:bg-muted border border-border text-foreground font-semibold py-2 px-4 rounded-xl transition-all"
                >
                  View Engagers
                </Link>
                <Link
                  href={`/monitor/${tweetId}`}
                  className="bg-card hover:bg-muted border border-border text-foreground font-semibold py-2 px-4 rounded-xl transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Dashboard
                </Link>
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl mb-6">
                {error}
                <button onClick={() => setError(null)} className="ml-4 underline">
                  Dismiss
                </button>
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex gap-2 mb-6">
              {(['all', 'generated', 'edited', 'sent', 'skipped'] as StatusFilter[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card hover:bg-muted border border-border text-foreground'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              <div className="card-base p-3.5">
                <p className="text-muted-foreground text-xs">Total</p>
                <p className="text-xl font-bold">{total}</p>
              </div>
              <div className="card-base p-3.5">
                <p className="text-muted-foreground text-xs">Pending</p>
                <p className="text-xl font-bold">
                  {notifications.filter((n) => n.status === 'generated' || n.status === 'edited').length}
                </p>
              </div>
              <div className="card-base p-3.5">
                <p className="text-muted-foreground text-xs">Sent</p>
                <p className="text-xl font-bold text-green-600">
                  {notifications.filter((n) => n.status === 'sent').length}
                </p>
              </div>
              <div className="card-base p-3.5">
                <p className="text-muted-foreground text-xs">Skipped</p>
                <p className="text-xl font-bold text-gray-500">
                  {notifications.filter((n) => n.status === 'skipped').length}
                </p>
              </div>
            </div>

            {/* Notifications List */}
            {notifications.length === 0 ? (
              <div className="card-base p-12 text-center">
                <p className="text-muted-foreground">No notifications found.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {notifications.map((notification) => (
                  <div key={notification.id} className="card-base p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xl">{getActionIcon(notification.action_type)}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{notification.engager_name}</span>
                              <span className="text-muted-foreground">@{notification.engager_username}</span>
                              {getStatusBadge(notification.status)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {notification.engager_followers.toLocaleString()} followers | Score: {notification.importance_score}
                            </div>
                          </div>
                        </div>

                        {/* Content */}
                        {editingId === notification.id ? (
                          <div className="mb-4">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full p-3 bg-muted border border-border rounded-lg text-foreground min-h-[100px]"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleSaveEdit(notification.id)}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="bg-card hover:bg-muted border border-border px-4 py-2 rounded-lg font-medium"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-muted/50 p-4 rounded-lg mb-4 whitespace-pre-wrap font-mono text-sm">
                            {notification.edited_text || notification.generated_text}
                          </div>
                        )}

                        {/* Timestamps */}
                        <div className="text-xs text-muted-foreground">
                          Generated: {new Date(notification.generated_at).toLocaleString()}
                          {notification.edited_at && (
                            <> | Edited: {new Date(notification.edited_at).toLocaleString()}</>
                          )}
                          {notification.sent_at && (
                            <> | Sent: {new Date(notification.sent_at).toLocaleString()}</>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      {(notification.status === 'generated' || notification.status === 'edited') && (
                        <div className="flex flex-col gap-2 ml-4">
                          <button
                            onClick={() => handleSend(notification.id)}
                            disabled={sendingId === notification.id}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                          >
                            {sendingId === notification.id ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
                                Sending...
                              </>
                            ) : (
                              <>Send to Slack</>
                            )}
                          </button>
                          <button
                            onClick={() => handleEdit(notification)}
                            className="bg-card hover:bg-muted border border-border px-4 py-2 rounded-lg font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleSkip(notification.id)}
                            className="text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg font-medium"
                          >
                            Skip
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
