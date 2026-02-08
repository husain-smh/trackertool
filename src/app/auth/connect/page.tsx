'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import Link from 'next/link';

/**
 * OAuth Connect Page - "Lab Report" Style
 * 
 * Design System: BrandWorks (Premium Dark)
 * - Paper background (inherited)
 * - Ink typography (Serif headings, Mono data)
 * - Solid borders, no shadows
 * - "Form" or "Contract" aesthetic
 */

function ConnectContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get('client_id');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = () => {
    if (!clientId) return;
    setIsConnecting(true);
    window.location.href = `/api/auth/x/authorize?client_id=${encodeURIComponent(clientId)}`;
  };

  // Error State - "Invalid Form"
  if (!clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full border-2 border-destructive bg-red-50/50 p-8 text-center">
          <div className="font-mono text-xs text-destructive uppercase tracking-widest mb-2">Error: Missing Parameters</div>
          <h1 className="font-sans text-2xl font-bold text-destructive mb-4">Invalid Request</h1>
          <p className="font-sans text-destructive/80 mb-6">
            The authorization request is incomplete. Missing Client ID.
          </p>
          <Link href="/" className="inline-block border-b border-destructive text-destructive font-mono text-sm hover:opacity-70">
            RETURN TO INDEX
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Document Container */}
      <div className="max-w-[500px] w-full border-2 border-foreground bg-background p-6 md:p-12 relative">
        {/* Header / Stamp */}
        <div className="text-center mb-10">
          <div className="inline-block border border-foreground p-2 mb-6 transform -rotate-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em]">BrandWorks</div>
          </div>
          <h1 className="font-sans text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
            Connect to BrandWorks
          </h1>
          <p className="font-sans text-lg text-foreground/80 leading-relaxed">
            Authorization required for detailed analysis.
          </p>
        </div>

        {/* Permissions Form */}
        <div className="mb-10 space-y-6">
          <div className="border-t border-foreground/30 pt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Required Access</h3>
            
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-1 w-4 h-4 border border-foreground flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold">✓</span>
                </div>
                <div>
                  <h4 className="font-sans font-bold text-foreground text-lg">Read engagement data</h4>
                  <p className="font-mono text-xs text-muted-foreground mt-1">Allows analysis of likes, replies, and audience demographics.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="mt-1 w-4 h-4 border border-foreground flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold">✓</span>
                </div>
                <div>
                  <h4 className="font-sans font-bold text-foreground text-lg">Verify identity</h4>
                  <p className="font-mono text-xs text-muted-foreground mt-1">Confirm account ownership for secure reporting.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-foreground/30 pt-6">
            <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">Security Constraints (Strictly Prohibited)</h3>
            <ul className="space-y-2 font-mono text-xs text-foreground/70">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-foreground rounded-full"></span>
                <span>NO WRITE ACCESS (Cannot post tweets)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-foreground rounded-full"></span>
                <span>NO PASSWORD ACCESS</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-foreground rounded-full"></span>
                <span>NO DIRECT MESSAGE (DM) READING</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Action Area */}
        <div className="space-y-4">
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full bg-foreground text-background font-mono uppercase tracking-widest py-4 border-2 border-transparent hover:bg-transparent hover:text-foreground hover:border-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
          >
            {isConnecting ? (
              <span className="animate-pulse">ESTABLISHING CONNECTION...</span>
            ) : (
              <span>[ AUTHORIZE APPLICATION ]</span>
            )}
          </button>
          
          <p className="text-center font-mono text-[10px] text-muted-foreground">
            By proceeding, you acknowledge the <a href="#" className="underline hover:text-foreground">Terms of Analysis</a> and <a href="#" className="underline hover:text-foreground">Privacy Protocol</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center font-mono text-xs uppercase tracking-widest">
        Loading Interface...
      </div>
    }>
      <ConnectContent />
    </Suspense>
  );
}

