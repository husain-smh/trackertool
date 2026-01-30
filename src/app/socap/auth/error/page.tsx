'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/**
 * OAuth Error Page
 * 
 * Shown when OAuth authorization fails.
 */

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'An unknown error occurred';

  const handleRetry = () => {
    // Go back to try again
    window.history.back();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card rounded-sm p-8 max-w-sm w-full text-center border border-border">
        {/* Error Icon */}
        <div className="w-12 h-12 bg-muted/40 border border-border rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-[1.75rem] leading-[1.4] font-normal text-foreground mb-2">
          Connection Failed
        </h1>

        {/* Error Message */}
        <div className="bg-background rounded-sm p-4 mb-6 border border-border">
          <p className="text-xs text-destructive">
            {error}
          </p>
        </div>

        {/* Help Text */}
        <p className="text-muted-foreground text-sm mb-6">
          This might happen if you denied the authorization request or if the link has expired.
        </p>

        {/* Buttons */}
        <div className="space-y-2.5">
          <button
            onClick={handleRetry}
            className="w-full py-2.5 px-4 border border-[#2F6FED] text-[#2F6FED] rounded-sm text-sm
                       hover:bg-[#2F6FED]/5 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => window.close()}
            className="w-full py-2.5 px-4 border border-border text-foreground rounded-sm text-sm
                       hover:bg-muted/30 transition-colors"
          >
            Close Window
          </button>
        </div>

        {/* Footer note */}
        <p className="text-[10px] text-muted-foreground mt-3">
          Need help? Contact support.
        </p>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-border border-t-transparent rounded-full"></div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
