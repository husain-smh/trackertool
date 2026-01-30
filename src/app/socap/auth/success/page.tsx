'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/**
 * OAuth Success Page
 * 
 * Shown after a client successfully authorizes their X account.
 * Displays their connected username and a message to close the tab.
 */

function SuccessContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get('username');
  const name = searchParams.get('name');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card rounded-sm p-8 max-w-sm w-full text-center border border-border">
        {/* Success Icon */}
        <div className="w-12 h-12 bg-muted/40 border border-border rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-[1.75rem] leading-[1.4] font-normal text-foreground mb-2">
          You&apos;re Connected!
        </h1>

        {/* Connected Account Info */}
        {username && (
          <div className="bg-background rounded-sm p-4 mb-6 border border-border">
            <div className="flex items-center justify-center gap-2.5">
              <div className="w-8 h-8 bg-background border border-border rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm text-foreground">@{username}</p>
                {name && <p className="text-xs text-muted-foreground">{name}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Message */}
        <p className="text-muted-foreground text-sm mb-6">
          Your X account has been connected successfully. We&apos;ll start tracking engagement on your posts automatically.
        </p>

        {/* Close Button */}
        <button
          onClick={() => window.close()}
          className="w-full py-2.5 px-4 border border-[#2F6FED] text-[#2F6FED] rounded-sm text-sm
                     hover:bg-[#2F6FED]/5 transition-colors"
        >
          Close Window
        </button>

        {/* Footer note */}
        <p className="text-[10px] text-muted-foreground mt-3">
          You can revoke access anytime from your X settings.
        </p>
      </div>
    </div>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-border border-t-transparent rounded-full"></div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
