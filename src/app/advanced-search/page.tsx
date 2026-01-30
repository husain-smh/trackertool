'use client';

import { useCallback, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';

type QueryType = 'Latest' | 'Top';

type ApiTweet = {
  id: string;
  url?: string;
  text?: string;
  createdAt?: string;
  lang?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  quoteCount?: number;
  viewCount?: number;
  author?: {
    userName?: string;
    name?: string;
    profilePicture?: string;
    isBlueVerified?: boolean;
  };
};

type ApiResponse =
  | {
      success: true;
      query: string;
      queryType: QueryType;
      cursorUsed: string;
      tweets: ApiTweet[];
      has_next_page: boolean;
      next_cursor: string;
    }
  | {
      error: string;
      details?: string;
      statusCode?: number;
      retryable?: boolean;
    };

function formatISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildQuery(options: {
  keyword: string;
  exactPhrase: boolean;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  extraOperators?: string;
}): string {
  const keywordPart = options.exactPhrase ? `"${options.keyword}"` : options.keyword;
  const parts = [
    keywordPart,
    `since:${options.since}`,
    `until:${options.until}`,
    options.extraOperators?.trim() ? options.extraOperators.trim() : '',
  ].filter(Boolean);

  return parts.join(' ');
}

function safeTextPreview(text: string | undefined, maxLen: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export default function AdvancedSearchPage() {
  const todayUtc = useMemo(() => new Date(), []);
  const defaultUntil = useMemo(() => formatISODate(todayUtc), [todayUtc]);
  const defaultSince = useMemo(() => {
    const d = new Date(todayUtc);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return formatISODate(d);
  }, [todayUtc]);

  const [keyword, setKeyword] = useState('');
  const [exactPhrase, setExactPhrase] = useState(true);
  const [queryType, setQueryType] = useState<QueryType>('Latest');
  const [since, setSince] = useState(defaultSince);
  const [until, setUntil] = useState(defaultUntil);
  const [extraOperators, setExtraOperators] = useState('');

  const [tweets, setTweets] = useState<ApiTweet[]>([]);
  const [nextCursor, setNextCursor] = useState<string>('');
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guardrails (backend-ish)
  const [maxPages, setMaxPages] = useState<number>(10);
  const [pageCount, setPageCount] = useState<number>(0);
  const [maxTweets, setMaxTweets] = useState<number>(200);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMaxPages, setExportMaxPages] = useState<number>(500);
  const [exportMaxTweets, setExportMaxTweets] = useState<number>(10000);
  const [exportDelayMs, setExportDelayMs] = useState<number>(350);

  const computedQuery = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return '';
    return buildQuery({ keyword: trimmed, exactPhrase, since, until, extraOperators });
  }, [keyword, exactPhrase, since, until, extraOperators]);

  const canSearch = useMemo(() => {
    const k = keyword.trim();
    if (!k) return false;
    if (!since || !until) return false;
    if (since > until) return false;
    return true;
  }, [keyword, since, until]);

  const fetchPage = useCallback(
    async (cursor: string, isNewSearch: boolean) => {
      if (!computedQuery) return;
      if (!isNewSearch) {
        if (pageCount >= maxPages) {
          setError(`Limit reached: max pages (${maxPages}). Increase the limit to load more.`);
          return;
        }
        if (tweets.length >= maxTweets) {
          setError(`Limit reached: max tweets (${maxTweets}). Increase the limit to load more.`);
          return;
        }
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          query: computedQuery,
          queryType,
        });
        // First page is "" per docs — keep it explicit to avoid ambiguity.
        params.set('cursor', cursor ?? '');

        const res = await fetch(`/api/twitter/advanced-search?${params.toString()}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = (await res.json()) as ApiResponse;

        if (!res.ok || 'error' in data) {
          const msg =
            (data as any)?.error ||
            (data as any)?.details ||
            `Failed to fetch advanced search results (HTTP ${res.status})`;
          setError(msg);
          return;
        }

        setTweets((prev) => {
          const merged = isNewSearch ? data.tweets : [...prev, ...data.tweets];
          // Hard stop safety: keep within maxTweets even if API returns more.
          return merged.slice(0, maxTweets);
        });

        setHasNextPage(Boolean(data.has_next_page) && Boolean(data.next_cursor));
        setNextCursor(data.next_cursor || '');
        setPageCount((prev) => (isNewSearch ? 1 : prev + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error');
      } finally {
        setIsLoading(false);
      }
    },
    [computedQuery, queryType, pageCount, maxPages, tweets.length, maxTweets]
  );

  const handleSearch = useCallback(async () => {
    if (!canSearch) return;
    setTweets([]);
    setNextCursor('');
    setHasNextPage(false);
    setPageCount(0);
    await fetchPage('', true);
  }, [canSearch, fetchPage]);

  const handleLoadMore = useCallback(async () => {
    if (isLoading) return;
    await fetchPage(nextCursor, false);
  }, [fetchPage, isLoading, nextCursor]);

  const handleExportCsv = useCallback(async () => {
    if (!canSearch || !computedQuery) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const res = await fetch('/api/twitter/advanced-search/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: computedQuery,
          queryType,
          format: 'xlsx',
          maxPages: exportMaxPages,
          maxTweets: exportMaxTweets,
          pageDelayMs: exportDelayMs,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const msg =
          data?.error ||
          data?.details ||
          `Export failed (HTTP ${res.status})`;
        setExportError(msg);
        return;
      }

      const contentDisposition = res.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || 'advanced-search-export.xlsx';

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Network error while exporting');
    } finally {
      setIsExporting(false);
    }
  }, [canSearch, computedQuery, queryType, exportDelayMs, exportMaxPages, exportMaxTweets]);

  return (
    <div className="min-h-screen bg-transparent text-[#2B2B2B] font-sans">
      <Navbar />

      <main className="relative pt-32 pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center mb-16">
          <h1 className="text-[2.5rem] leading-[1.3] font-normal mb-6 text-[#2B2B2B]">Advanced Search</h1>
          <p className="text-[1.125rem] leading-[1.75] text-[#6B6B6B] max-w-[70ch] mx-auto">
            Search tweets using Twitter’s advanced query operators (via twitterapi.io) with cursor pagination.
          </p>
        </div>

        <div className="max-w-[900px] mx-auto mb-10 bg-[#FEFEFE] border border-[#E8E4DF] p-8 rounded-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Keyword / phrase</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder='e.g. "input 11 labs"'
                className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                disabled={isLoading}
              />
              <div className="mt-3 flex items-center gap-3">
                <input
                  id="exactPhrase"
                  type="checkbox"
                  checked={exactPhrase}
                  onChange={(e) => setExactPhrase(e.target.checked)}
                  disabled={isLoading}
                />
                <label htmlFor="exactPhrase" className="text-sm text-[#6B6B6B]">
                  Treat as exact phrase (wrap in quotes)
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Query type</label>
              <select
                value={queryType}
                onChange={(e) => setQueryType(e.target.value as QueryType)}
                className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                disabled={isLoading}
              >
                <option value="Latest">Latest</option>
                <option value="Top">Top</option>
              </select>
              <p className="mt-2 text-sm text-[#6B6B6B]">Latest is chronological, Top is engagement-weighted.</p>
            </div>

            <div>
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Time range (default: past year)</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#6B6B6B] mb-1">Since</label>
                  <input
                    type="date"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    className="w-full px-3 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6B6B6B] mb-1">Until</label>
                  <input
                    type="date"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    className="w-full px-3 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                    disabled={isLoading}
                  />
                </div>
              </div>
              {since && until && since > until && (
                <p className="mt-2 text-sm text-red-600">Since must be earlier than Until.</p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Extra operators (optional)</label>
              <input
                value={extraOperators}
                onChange={(e) => setExtraOperators(e.target.value)}
                placeholder="e.g. lang:en -filter:retweets"
                className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] placeholder-[#6B6B6B]/50 focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                disabled={isLoading}
              />
              <p className="mt-2 text-sm text-[#6B6B6B]">
                Use operators from your `advancesearch.md` list (e.g. <code>from:</code>, <code>lang:</code>,{' '}
                <code>-filter:retweets</code>, <code>min_faves:</code>).
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Max pages</label>
              <input
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={(e) => setMaxPages(Math.max(1, Math.min(200, parseInt(e.target.value || '1', 10))))}
                className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                disabled={isLoading}
              />
              <p className="mt-2 text-xs text-[#6B6B6B]">
                UI cap is 200 pages. For bigger pulls (e.g. 10k+ tweets), use Export below.
              </p>
            </div>
            <div>
              <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Max tweets</label>
              <input
                type="number"
                min={20}
                max={2000}
                value={maxTweets}
                onChange={(e) => setMaxTweets(Math.max(20, Math.min(2000, parseInt(e.target.value || '20', 10))))}
                className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                disabled={isLoading}
              />
              <p className="mt-2 text-xs text-[#6B6B6B]">
                UI cap is 2000 tweets (browser safety). Export can go higher.
              </p>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSearch}
                disabled={!canSearch || isLoading}
                className="w-full bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:border-[#2F6FED] hover:text-[#2F6FED] hover:underline disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
              >
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <div className="mt-10 pt-8 border-t border-[#E8E4DF]">
            <h2 className="text-[1.25rem] leading-[1.4] font-normal text-[#2B2B2B] mb-2">Export (Excel .xlsx)</h2>
            <p className="text-sm text-[#6B6B6B] mb-6">
              Export runs on the server and can paginate deeper (recommended for 10k+).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Export max pages</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={exportMaxPages}
                  onChange={(e) => setExportMaxPages(Math.max(1, Math.min(2000, parseInt(e.target.value || '1', 10))))}
                  className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                  disabled={isExporting}
                />
              </div>
              <div>
                <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Export max tweets</label>
                <input
                  type="number"
                  min={100}
                  max={20000}
                  value={exportMaxTweets}
                  onChange={(e) => setExportMaxTweets(Math.max(100, Math.min(20000, parseInt(e.target.value || '100', 10))))}
                  className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                  disabled={isExporting}
                />
              </div>
              <div>
                <label className="block text-sm text-[#2B2B2B] mb-2 font-normal">Delay per page (ms)</label>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={exportDelayMs}
                  onChange={(e) => setExportDelayMs(Math.max(0, Math.min(5000, parseInt(e.target.value || '0', 10))))}
                  className="w-full px-4 py-3 bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm text-[#2B2B2B] focus:border-[#2F6FED] focus:outline-none transition-colors text-base font-sans"
                  disabled={isExporting}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleExportCsv}
                  disabled={!canSearch || isExporting}
                  className="w-full bg-[#2B2B2B] text-white hover:bg-[#2B2B2B]/90 disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
                >
                  {isExporting ? 'Exporting...' : 'Export Excel (.xlsx)'}
                </button>
              </div>
            </div>

            {exportError && (
              <div className="mt-4 p-4 border rounded-sm text-sm border-red-200 text-red-600 bg-[#FEFEFE]">
                {exportError}
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="text-sm text-[#6B6B6B]">
              Built query:{' '}
              <span className="text-[#2B2B2B] break-words">
                {computedQuery || <span className="text-[#6B6B6B]">(enter a keyword)</span>}
              </span>
            </div>
            <div className="text-sm text-[#6B6B6B] mt-2">
              Pages loaded: <span className="text-[#2B2B2B]">{pageCount}</span> · Tweets loaded:{' '}
              <span className="text-[#2B2B2B]">{tweets.length}</span>
            </div>
          </div>

          {error && (
            <div className="mt-6 p-4 border rounded-sm text-sm border-red-200 text-red-600 bg-[#FEFEFE]">{error}</div>
          )}
        </div>

        <div className="max-w-[1200px] mx-auto">
          {tweets.length === 0 ? (
            <div className="text-center text-[#6B6B6B]">
              <p>No results yet. Enter a keyword and search.</p>
            </div>
          ) : (
            <div className="bg-[#FEFEFE] border border-[#E8E4DF] rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#F5F3F0] text-[#6B6B6B] text-sm uppercase tracking-wide border-b border-[#E8E4DF]">
                    <tr>
                      <th className="px-6 py-4 font-normal">Tweet</th>
                      <th className="px-6 py-4 font-normal">Author</th>
                      <th className="px-6 py-4 font-normal">Created</th>
                      <th className="px-6 py-4 font-normal">Stats</th>
                      <th className="px-6 py-4 font-normal">Text</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E4DF]">
                    {tweets.map((t) => (
                      <tr key={t.id} className="hover:bg-[#F5F3F0]/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-[#2B2B2B]">
                          {t.url ? (
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-[#2F6FED] hover:underline"
                            >
                              {t.id}
                            </a>
                          ) : (
                            t.id
                          )}
                        </td>
                        <td className="px-6 py-4 text-[#2B2B2B]">
                          {t.author?.userName ? `@${t.author.userName}` : t.author?.name || '—'}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-6 py-4 text-[#6B6B6B] text-sm">
                          <div>❤️ {t.likeCount ?? 0}</div>
                          <div>💬 {t.replyCount ?? 0}</div>
                          <div>🔁 {t.retweetCount ?? 0}</div>
                          <div>❝ {t.quoteCount ?? 0}</div>
                        </td>
                        <td className="px-6 py-4 text-[#2B2B2B] text-sm max-w-[520px]">
                          {safeTextPreview(t.text, 220) || <span className="text-[#6B6B6B]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-6 border-t border-[#E8E4DF] flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                <div className="text-sm text-[#6B6B6B]">
                  {hasNextPage ? 'More results available.' : 'No more pages (or API returned no cursor).'}
                </div>
                <button
                  onClick={handleLoadMore}
                  disabled={!hasNextPage || isLoading}
                  className="bg-[#FEFEFE] text-[#2B2B2B] border border-[#E8E4DF] hover:bg-[#F5F3F0] hover:border-[#2F6FED] hover:text-[#2F6FED] hover:underline disabled:opacity-50 py-3 px-6 rounded-sm transition-all text-base"
                >
                  {isLoading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}



