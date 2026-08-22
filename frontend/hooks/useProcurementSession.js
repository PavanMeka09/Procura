'use client';

import { useState, useEffect, useCallback } from 'react';
import { getProcurement, resolveReview, subscribeEvents } from '../lib/api';

/**
 * Custom React hook to synchronize procurement session state via SSE and periodic polling fallback.
 */
export function useProcurementSession(initialSession) {
  const [session, setSession] = useState(initialSession);
  const [error, setError] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(null);

  const requestId = initialSession?.requestId;

  // Poll and subscribe to SSE events for live updates
  useEffect(() => {
    if (!requestId) return;

    let isMounted = true;

    const fetchLatestSession = async () => {
      try {
        const data = await getProcurement(requestId);
        if (isMounted && data?.session) {
          setSession(data.session);
        }
      } catch (err) {
        // Retain current session snapshot on background sync error
      }
    };

    // Initial fetch
    void fetchLatestSession();

    // Subscribe to SSE event stream
    const unsubscribeStream = subscribeEvents(
      requestId,
      () => {
        void fetchLatestSession();
      },
      () => {
        // SSE error handler
      }
    );

    // Fallback polling interval every 2.5s
    const pollInterval = setInterval(fetchLatestSession, 2500);

    return () => {
      isMounted = false;
      unsubscribeStream();
      clearInterval(pollInterval);
    };
  }, [requestId]);

  // Handle human review actions (approve / reject / stop)
  const handleReviewDecision = useCallback(
    async (decision) => {
      if (!requestId || submittingDecision) return;
      setError('');
      setSubmittingDecision(decision);
      try {
        const result = await resolveReview(requestId, decision);
        if (result?.session) {
          setSession(result.session);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit review decision.');
      } finally {
        setSubmittingDecision(null);
      }
    },
    [requestId, submittingDecision]
  );

  return {
    session,
    error,
    submittingDecision,
    handleReviewDecision,
  };
}
