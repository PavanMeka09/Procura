'use client';

import React from 'react';
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
 * critic reviews, policy gates, and vendor responses.
 */
export function NegotiationTimeline({ session }) {
  const recentEvents = session.events.slice(-12);

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <h3>Negotiation timeline</h3>
        <span className="muted">Round {Math.min(session.currentRound, 5)} of 5</span>
      </div>

      {recentEvents.length > 0 ? (
        <div className="timeline">
          {recentEvents.map((event) => {
            const tone = resolveEventTone(event.type, event);

            return (
              <div className={`timeline-item ${tone}`} key={event.id}>
                <div className="timeline-time">{formatTime(event.createdAt)}</div>
                <div className="timeline-dot">
                  <span />
                </div>
                <div className="timeline-copy">
                  <div className="timeline-top">
                    <StatusBadge tone={tone}>
                      {event.type.replace(/_/g, ' ')}
                    </StatusBadge>
                  </div>
                  <p>{event.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          Agent trace will appear here as the workspace runs.
        </div>
      )}
    </section>
  );
}
