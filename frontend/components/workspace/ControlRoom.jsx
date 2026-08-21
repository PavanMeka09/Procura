'use client';

import React, { useState, useMemo } from 'react';
import { Bell, CircleHelp, ChevronDown } from 'lucide-react';
import { SidebarRail } from '../navigation/SidebarRail';
import { RequestHeader } from './RequestHeader';
import { BestOfferCard } from './BestOfferCard';
import { VendorComparisonTable } from './VendorComparisonTable';
import { NegotiationTimeline } from './NegotiationTimeline';
import { VerificationRail } from './VerificationRail';
import { EvaluationLab } from '../evaluation/EvaluationLab';
import { useProcurementSession } from '../../hooks/useProcurementSession';

/**
 * Main application coordinator view combining the workspace control room,
 * timeline, vendor comparisons, verification rail, and evaluation dashboard.
 */
export function ControlRoom({ initialSession, onNew }) {
  const [activeView, setActiveView] = useState('control');
  const { session, error, handleReviewDecision } = useProcurementSession(initialSession);

  const statusBannerText = useMemo(() => {
    if (session.currentState === 'ACCEPTED') {
      return 'Procurement complete';
    }
    if (session.currentState === 'HUMAN_REVIEW') {
      return 'Waiting for approval';
    }
    return 'Agent is negotiating';
  }, [session.currentState]);

  return (
    <div className="app-shell">
      {/* Left sidebar navigation */}
      <SidebarRail
        onNew={onNew}
        onEvaluation={() => setActiveView('evaluation')}
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

          <div className="header-actions">
            <button type="button" className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button type="button" className="icon-button" aria-label="Help">
              <CircleHelp size={18} />
            </button>
            <div className="workspace-select">
              Enterprise IT <ChevronDown size={15} />
            </div>
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
              <div className="run-banner">
                <div>
                  <span className="live-dot" /> {statusBannerText}
                </div>
                <span className="muted">Session {session.id.slice(0, 8)}</span>
              </div>

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
            />
          </div>
        )}
      </main>
    </div>
  );
}
