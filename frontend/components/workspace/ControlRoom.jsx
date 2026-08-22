'use client';

import React, { useState, useMemo } from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { SidebarRail } from '../navigation/SidebarRail';
import { RequestHeader } from './RequestHeader';
import { BestOfferCard } from './BestOfferCard';
import { VendorComparisonTable } from './VendorComparisonTable';
import { NegotiationTimeline } from './NegotiationTimeline';
import { VerificationRail } from './VerificationRail';
import { EvaluationLab } from '../evaluation/EvaluationLab';
import { useProcurementSession } from '../../hooks/useProcurementSession';
import { getSessionStatusInfo } from '../../lib/status-helpers';

/**
 * Main application coordinator view combining the workspace control room,
 * timeline, vendor comparisons, verification rail, and evaluation dashboard.
 */
export function ControlRoom({ initialSession, onNew }) {
  const [activeView, setActiveView] = useState('control');
  const { session, error, submittingDecision, handleReviewDecision } = useProcurementSession(initialSession);

  const statusInfo = useMemo(
    () => getSessionStatusInfo(session.currentState),
    [session.currentState]
  );

  return (
    <div className="app-shell">
      {/* Left sidebar navigation */}
      <SidebarRail
        activeView={activeView}
        onSelectView={setActiveView}
        onNew={onNew}
      />

      {/* Main workspace arena */}
      <main className="workspace">
        {/* Workspace header */}
        <header className="workspace-header">
          <div>
            <h1>{activeView === 'evaluation' ? 'Evaluation' : 'Control room'}</h1>
            <p>
              {activeView === 'evaluation'
                ? 'Measure safety, recovery, and decision quality'
                : 'Monitor autonomous negotiations and outcomes'}
            </p>
          </div>

        </header>

        {/* Content switcher */}
        {activeView === 'evaluation' ? (
          <div className="workspace-content evaluation-content">
            <EvaluationLab />
          </div>
        ) : (
          <div className="workspace-content">
            <div className="main-column">
              {/* Active state live indicator */}
              <div className={`run-banner ${statusInfo.tone}`}>
                <div>
                  <span className={`live-dot ${statusInfo.tone}`} /> {statusInfo.bannerText}
                </div>
                <span className="muted">Session {session.id.slice(0, 8)}</span>
              </div>

              {/* Human Review Main Banner Callout */}
              {session.currentState === 'HUMAN_REVIEW' && (
                <div className="human-review-callout-banner">
                  <div className="callout-banner-icon">
                    <ShieldAlert size={18} />
                  </div>
                  <div className="callout-banner-text">
                    <strong>Human approval required</strong>
                    <p>
                      {session.humanReview?.reason ||
                        'An agent proposal was held by safety verification for human sign-off.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Agent Failure Callout Banner */}
              {session.currentState === 'FAILED' && (
                <div className="failure-callout-banner">
                  <div className="failure-callout-icon">
                    <AlertCircle size={18} />
                  </div>
                  <div className="failure-callout-text">
                    <strong>Agent failed — stopped safely</strong>
                    <p>
                      {session.stopReason ||
                        'The agent encountered an unexpected failure during negotiation.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Core negotiation panels */}
              <RequestHeader session={session} />
              <BestOfferCard session={session} />
              <VendorComparisonTable session={session} />
              <NegotiationTimeline session={session} />

              {error && <div className="form-error">{error}</div>}
            </div>

            {/* Safety & Critic verification right rail */}
            <VerificationRail
              session={session}
              onReview={handleReviewDecision}
              submittingDecision={submittingDecision}
            />
          </div>
        )}
      </main>
    </div>
  );
}
