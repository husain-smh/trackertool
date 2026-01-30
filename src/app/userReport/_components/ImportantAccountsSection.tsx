'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ImportantEngager = {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  followers: number;
  verified: boolean;
  importance_score: number;
  tweetEngagements: Array<{
    tweetId: string;
    tweetUrl: string;
    actions: string[];
  }>;
};

type PageInfo = {
  limit: number;
  skip: number;
  total: number;
  hasMore: boolean;
};

export function ImportantAccountsSection({
  identifier,
  initialLimit = 50,
}: {
  identifier: string;
  initialLimit?: number;
}) {
  const [items, setItems] = useState<ImportantEngager[]>([]);
  const [page, setPage] = useState<PageInfo>({ limit: initialLimit, skip: 0, total: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportAll, setExportAll] = useState(false);

  const currentPageNumber = useMemo(() => {
    if (page.limit <= 0) return 1;
    return Math.floor(page.skip / page.limit) + 1;
  }, [page.limit, page.skip]);

  const totalPages = useMemo(() => {
    if (page.limit <= 0) return 1;
    return Math.max(1, Math.ceil(page.total / page.limit));
  }, [page.limit, page.total]);

  const fetchPage = useCallback(
    async (nextSkip: number, nextLimit = page.limit) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(nextLimit),
          skip: String(Math.max(0, nextSkip)),
        });
        const res = await fetch(`/api/user-report/${encodeURIComponent(identifier)}/important-engagers?${params}`);
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to load important accounts');
        }
        setItems(json.items ?? []);
        setPage(json.page as PageInfo);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load important accounts');
      } finally {
        setLoading(false);
      }
    },
    [identifier, page.limit],
  );

  useEffect(() => {
    void fetchPage(0, initialLimit);
  }, [fetchPage, initialLimit]);

  const onExport = useCallback(() => {
    const params = new URLSearchParams();
    if (exportAll) {
      params.set('all', 'true');
      // Keep server-side safety cap configurable, but default is sane.
      params.set('limit', '5000');
    } else {
      params.set('skip', String(page.skip));
      params.set('limit', String(page.limit));
    }

    const url = `/api/user-report/${encodeURIComponent(identifier)}/important-engagers/export?${params.toString()}`;
    // Use a hard navigation so the browser downloads the attachment.
    window.location.href = url;
  }, [exportAll, identifier, page.limit, page.skip]);

  return (
    <div className="border-t-2 border-foreground pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {loading ? 'LOADING…' : `SHOWING ${Math.min(page.total, page.skip + 1)}–${Math.min(page.total, page.skip + items.length)} OF ${page.total}`}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <input
              type="checkbox"
              checked={exportAll}
              onChange={(e) => setExportAll(e.target.checked)}
              className="accent-foreground"
            />
            Export all
          </label>

          <button
            onClick={onExport}
            className="font-mono text-xs uppercase border border-foreground px-3 py-1.5 hover:bg-foreground hover:text-background transition-colors"
          >
            Export .xlsx
          </button>
        </div>
      </div>

      {error && (
        <div className="font-mono text-xs text-destructive border border-destructive/40 bg-red-50/40 p-3 mb-4">
          ⚠ {error}
        </div>
      )}

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-foreground/50">
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider">User Entity</th>
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-right">Imp. Score</th>
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider">Interactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/20">
              {items.map((engager) => (
                <tr key={engager.userId} className="hover:bg-foreground/5 transition-colors">
                  <td className="py-3 pr-4 align-top">
                    <div className="font-sans font-bold text-base leading-none mb-1">
                      {engager.name}
                      {engager.verified && (
                        <span className="ml-1 text-blue-600 text-[10px] align-top">✓</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mb-1">
                      @{String(engager.username || '').replace(/^@/, '')}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {new Intl.NumberFormat('en-US', {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(engager.followers)}{' '}
                      followers
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right align-top">
                    <span className="font-bold font-mono text-emerald-700">
                      {Number.isFinite(engager.importance_score)
                        ? engager.importance_score.toFixed(1)
                        : '—'}
                    </span>
                  </td>
                  <td className="py-3 align-top font-mono text-xs">
                    {engager.tweetEngagements.map((te) => (
                      <div key={te.tweetId} className="mb-1">
                        <a
                          href={te.tweetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline hover:text-foreground transition-colors group block"
                        >
                          <span className="text-muted-foreground mr-1 group-hover:text-foreground/70">
                            [Tweet {String(te.tweetId).slice(-4)}]
                          </span>
                          <span className="text-foreground/80 group-hover:text-foreground">
                            {te.actions
                              .map((action) =>
                                action === 'replied'
                                  ? 'Replied'
                                  : action === 'retweeted'
                                    ? 'Retweeted'
                                    : action === 'quoted'
                                      ? 'Quoted'
                                      : action === 'liked'
                                        ? 'Liked'
                                        : action,
                              )
                              .join(', ')}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-1 opacity-0 group-hover:opacity-100">
                            ↗
                          </span>
                        </a>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div className="font-mono text-xs text-muted-foreground border border-dashed border-foreground/30 p-4 text-center">
            NO HIGH-SIGNAL ACCOUNTS IDENTIFIED
          </div>
        )
      )}

      {page.total > page.limit && (
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-foreground">
          <button
            onClick={() => fetchPage(page.skip - page.limit)}
            disabled={loading || page.skip === 0}
            className="font-mono text-xs uppercase disabled:opacity-30 hover:underline"
          >
            ← Previous Page
          </button>
          <div className="font-mono text-xs">
            PAGE {currentPageNumber} OF {totalPages}
          </div>
          <button
            onClick={() => fetchPage(page.skip + page.limit)}
            disabled={loading || !page.hasMore}
            className="font-mono text-xs uppercase disabled:opacity-30 hover:underline"
          >
            Next Page →
          </button>
        </div>
      )}
    </div>
  );
}


