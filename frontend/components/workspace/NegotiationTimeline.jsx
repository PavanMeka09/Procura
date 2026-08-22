'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Radio } from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resolveEventTone(eventType, event) {
  if (eventType === 'CRITIC_RESULT') {
    const decision = event?.metadata?.decision;
    if (decision === 'PASS') return 'success';
    if (decision === 'WARN') return 'warning';
    return 'danger';
  }

  if (['DEAL_ACCEPTED', 'POLICY_RESULT'].includes(eventType)) {
    return 'success';
  }

  if (['ACTION_BLOCKED', 'HUMAN_REVIEW_REQUIRED'].includes(eventType)) {
    return 'warning';
  }

  return 'blue';
}

/**
 * Chronological negotiation trace panel showing autonomous agent proposals,
 * critic reviews, policy gates, and vendor responses with full event history,
 * scrollable view, and dynamic ripple animations on the current step.
 */
export function NegotiationTimeline({ session }) {
  const events = session?.events || [];
  const activeVendor = session?.vendors?.find((v) => v.id === session?.currentVendorId);
  const maxRounds = session?.maxRoundsPerVendor || 3;
  const currentRoundDisplay = session?.currentRound ? Math.min(session.currentRound, maxRounds) : 1;
  const isTerminal = ['ACCEPTED', 'STOPPED', 'FAILED'].includes(session?.currentState);

  const timelineContainerRef = useRef(null);
  const bottomAnchorRef = useRef(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const scrollToBottom = useCallback((smooth = true) => {
    if (bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'nearest',
      });
    }
  }, []);

  const lastEventKey = events.length > 0 
    ? (events[events.length - 1]?.id || events[events.length - 1]?.createdAt || events.length)
    : null;

  // Auto-scroll on mount and when new events arrive or update
  useEffect(() => {
    if (!isScrolledUp) {
      scrollToBottom(true);
    }
  }, [events.length, lastEventKey, isScrolledUp, scrollToBottom]);

  // Track scroll position to know if user manually scrolled up
  const handleScroll = () => {
    if (!timelineContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = timelineContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsScrolledUp(distanceFromBottom > 70);
  };

  const roundBadgeText = isTerminal
    ? `${events.length} event${events.length === 1 ? '' : 's'} · ${session?.offers?.length || 0} offer${session?.offers?.length === 1 ? '' : 's'} (${session?.vendors?.length || 0} vendors)`
    : activeVendor
    ? `${events.length} event${events.length === 1 ? '' : 's'} · Round ${currentRoundDisplay} of ${maxRounds} (${activeVendor.name})`
    : `${events.length} event${events.length === 1 ? '' : 's'} · Round ${currentRoundDisplay} of ${maxRounds}`;

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <h3>
          Negotiation timeline
          {!isTerminal && (
            <span className="live-badge" title="Live negotiation active">
              <Radio size={12} /> LIVE
            </span>
          )}
        </h3>
        <div className="timeline-header-actions">
          <span className="muted">{roundBadgeText}</span>
          {isScrolledUp && (
            <button
              type="button"
              className="scroll-latest-btn"
              onClick={() => {
                setIsScrolledUp(false);
                scrollToBottom(true);
              }}
              title="Jump to latest event"
            >
              <ArrowDown size={12} />
              Latest
            </button>
          )}
        </div>
      </div>

      {events.length > 0 ? (
        <div
          className="timeline"
          ref={timelineContainerRef}
          onScroll={handleScroll}
        >
          {events.map((event, index) => {
            const tone = resolveEventTone(event.type, event);
            const isCurrent = index === events.length - 1;

            return (
              <div
                className={`timeline-item ${tone} ${isCurrent ? 'is-current' : ''}`}
                key={event.id || `${event.type}-${event.createdAt || index}`}
              >
                <div className="timeline-time">{formatTime(event.createdAt)}</div>
                <div className="timeline-dot">
                  <span className="dot-node" />
                  {isCurrent && (
                    <div className="ripple-container">
                      <span className="ripple-ring ring-1" />
                      <span className="ripple-ring ring-2" />
                    </div>
                  )}
                </div>
                <div className="timeline-copy">
                  <div className="timeline-top">
                    <StatusBadge tone={tone}>
                      {event.type.replace(/_/g, ' ')}
                    </StatusBadge>
                    {isCurrent && !isTerminal && (
                      <span className="current-pulse-tag">Current</span>
                    )}
                  </div>
                  <p>{event.message}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomAnchorRef} style={{ height: 1 }} />
        </div>
      ) : (
        <div className="empty-state">
          Agent trace will appear here as the workspace runs.
        </div>
      )}
    </section>
  );
}
