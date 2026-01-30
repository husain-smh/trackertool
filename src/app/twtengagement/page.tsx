'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';

interface EngagementData {
  author_name: string;
  tweet_url: string;
  spreadsheetId: string;
}

interface ExistingTweet {
  tweet_id: string;
  status: string;
  author_name: string;
  total_engagers: number;
  engagers_above_10k: number;
  engagers_below_10k: number;
  analyzed_at?: string;
  created_at: string;
  message: string;
}

export default function TwitterEngagement() {
  const router = useRouter();
  const [tweetUrl, setTweetUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData[] | null>(null);
  const [existingTweet, setExistingTweet] = useState<ExistingTweet | null>(null);
  const [showExistingModal, setShowExistingModal] = useState(false);
  const [isMonitoringLoading, setIsMonitoringLoading] = useState(false);
  const [, setPollingTweetId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to construct Google Sheets URL from spreadsheetId
  const constructSheetsUrl = (spreadsheetId: string) => {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  };

  const handleStartMonitoring = async () => {
    if (!tweetUrl.trim()) {
      setMessage({
        type: 'error',
        text: 'Please enter a Twitter URL'
      });
      return;
    }

    setIsMonitoringLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/monitor-tweet/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweetUrl: tweetUrl.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || 'Monitoring started.'
        });
        const tweetIdMatch = tweetUrl.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
        if (tweetIdMatch && tweetIdMatch[1]) {
          setTimeout(() => {
            router.push(`/monitor/${tweetIdMatch[1]}`);
          }, 1500);
        }
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to start monitoring'
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error.'
      });
    } finally {
      setIsMonitoringLoading(false);
    }
  };

  const pollTweetStatus = async (tweetId: string) => {
    try {
      const response = await fetch(`/api/tweets/${tweetId}`);
      const data = await response.json();

      if (data.success && data.tweet) {
        if (data.tweet.status === 'completed') {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setPollingTweetId(null);
          setIsLoading(false);
          setMessage({
            type: 'success',
            text: 'Analysis completed.'
          });
          router.push(`/tweets/${tweetId}`);
        } else if (data.tweet.status === 'failed') {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setPollingTweetId(null);
          setIsLoading(false);
          setMessage({
            type: 'error',
            text: data.tweet.error || 'Analysis failed.'
          });
        }
      }
    } catch (error) {
      console.error('Error polling tweet status:', error);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setPollingTweetId(null);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleReanalyze = async () => {
    if (!tweetUrl.trim()) return;
    
    setShowExistingModal(false);
    setIsLoading(true);
    setMessage(null);
    setEngagementData(null);

    try {
      const response = await fetch('/api/tweets/analyze-native', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweetUrl: tweetUrl.trim(), reanalyze: true }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const tweetId = data.tweet_id;
        setPollingTweetId(tweetId);
        setMessage({
          type: 'success',
          text: 'Re-analysis started.'
        });

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
        pollingIntervalRef.current = setInterval(() => {
          if (tweetId) {
            pollTweetStatus(tweetId);
          }
        }, 3000);

        pollTweetStatus(tweetId);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to re-analyze tweet'
        });
        setIsLoading(false);
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error.'
      });
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tweetUrl.trim()) {
      setMessage({
        type: 'error',
        text: 'Please enter a Twitter URL'
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);
    setEngagementData(null);
    setShowExistingModal(false);

    try {
      const response = await fetch('/api/tweets/analyze-native', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweetUrl: tweetUrl.trim() }),
      });

      const data = await response.json();

      if (data.already_exists) {
        setExistingTweet(data);
        setShowExistingModal(true);
        setIsLoading(false);
        return;
      }

      if (response.ok && data.success) {
        const tweetId = data.tweet_id;
        setPollingTweetId(tweetId);
        setMessage({
          type: 'success',
          text: 'Analysis started.'
        });

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
        pollingIntervalRef.current = setInterval(() => {
          if (tweetId) {
            pollTweetStatus(tweetId);
          }
        }, 3000);

        pollTweetStatus(tweetId);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to start analysis'
        });
        setIsLoading(false);
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error.'
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-[#4A4A4A] font-sans">
      <Navbar />
      
      {/* Existing Tweet Modal */}
      {showExistingModal && existingTweet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#F5F3F0]/90">
          <div className="bg-white rounded-sm p-8 max-w-lg w-full border border-[#E8E4DF]">
            <div className="flex items-start justify-between mb-8">
              <div>
                <h3 className="text-[#2B2B2B] text-xl font-normal mb-2">Analyzed Tweet</h3>
                <p className="text-[#6B6B6B] text-sm">{existingTweet.message}</p>
              </div>
              <button
                onClick={() => setShowExistingModal(false)}
                className="text-[#6B6B6B] hover:text-[#2B2B2B]"
              >
                Close
              </button>
            </div>
            
            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-center py-2 border-b border-[#E8E4DF]">
                <span className="text-[#6B6B6B]">Author</span>
                <span className="text-[#2B2B2B]">{existingTweet.author_name}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#E8E4DF]">
                <span className="text-[#6B6B6B]">Status</span>
                <span className="text-[#2B2B2B]">{existingTweet.status}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[#E8E4DF]">
                <span className="text-[#6B6B6B]">Total Engagers</span>
                <span className="text-[#2B2B2B]">{existingTweet.total_engagers}</span>
              </div>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => router.push(`/tweets/${existingTweet.tweet_id}`)}
                className="flex-1 bg-[#2B2B2B] text-white hover:bg-[#2B2B2B]/90 py-3 px-4 rounded-sm transition-all"
              >
                View Analysis
              </button>
              <button
                onClick={handleReanalyze}
                className="flex-1 bg-[#FEFEFE] border border-[#E8E4DF] text-[#2B2B2B] hover:bg-[#F5F3F0] hover:border-[#2F6FED] hover:text-[#2F6FED] py-3 px-4 rounded-sm transition-all"
              >
                Re-analyze
              </button>
            </div>
          </div>
        </div>
      )}
      
      <main className="relative pt-32 pb-20 px-6">
        {/* Header Section */}
        <div className="max-w-[800px] mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">
            Engagement Analysis
          </h1>
          
          <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[65ch] mx-auto">
            Deep-dive into tweet engagement.
          </p>
        </div>

        {/* Input Section */}
        <div className="max-w-[650px] mx-auto mb-20">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label 
                htmlFor="tweetUrl" 
                className="block text-sm text-[#2B2B2B] mb-2 font-normal"
              >
                Tweet URL
              </label>
              <div className="relative">
                <input
                  type="url"
                  id="tweetUrl"
                  value={tweetUrl}
                  onChange={(e) => setTweetUrl(e.target.value)}
                  placeholder="https://x.com/..."
                  className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                  disabled={isLoading}
                />
              </div>
              <p className="mt-2 text-sm text-[#6B6B6B]">
                Enter full tweet URL
              </p>
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={isLoading || !tweetUrl.trim()}
                className="flex-1 bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:border-[#2F6FED] hover:text-[#2F6FED] hover:underline disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
              >
                {isLoading ? 'Analyzing...' : 'Analyze'}
              </button>
              
              <button
                type="button"
                onClick={handleStartMonitoring}
                disabled={isMonitoringLoading || !tweetUrl.trim()}
                className="flex-1 bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:border-[#2F6FED] hover:text-[#2F6FED] hover:underline disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
              >
                {isMonitoringLoading ? 'Starting...' : 'Monitor (72h)'}
              </button>
            </div>
          </form>

          {/* Message Display */}
          {message && (
            <div className={`mt-6 p-4 border rounded-sm text-sm ${
              message.type === 'success' 
                ? 'border-[#E8E4DF] text-[#2B2B2B] bg-[#FEFEFE]' 
                : 'border-red-200 text-red-600 bg-[#FEFEFE]'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        {/* Engagement Results Display */}
        {engagementData && engagementData.length > 0 && (
          <div className="max-w-[800px] mx-auto space-y-8">
            <h2 className="text-[1.5rem] leading-[1.5] font-normal text-[#2B2B2B] text-center mb-8">
              Results
            </h2>

            {engagementData.map((item, index) => (
              <div key={index} className="bg-[#FEFEFE] border border-[#E8E4DF] p-8 rounded-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <h3 className="text-[#2B2B2B] text-lg font-normal mb-2">
                      @{item.author_name}
                    </h3>
                    <a 
                      href={item.tweet_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[#6B6B6B] hover:text-[#2B2B2B] hover:underline text-sm"
                    >
                      View Original Tweet
                    </a>
                  </div>

                  <a
                    href={constructSheetsUrl(item.spreadsheetId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#F5F3F0] text-[#2B2B2B] hover:bg-[#E8E4DF] hover:text-[#2F6FED] rounded-sm transition-colors text-sm"
                  >
                    Open Spreadsheet
                  </a>
                </div>
              </div>
            ))}

            <div className="text-center pt-8">
              <button
                onClick={() => {
                  setEngagementData(null);
                  setMessage(null);
                }}
                className="text-[#2B2B2B] border-b border-[#2B2B2B] hover:border-[#2F6FED] hover:text-[#2F6FED] transition-colors pb-1"
              >
                Analyze Another Tweet
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

