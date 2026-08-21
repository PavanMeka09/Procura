'use client';

import React from 'react';
import {
  Activity,
  Check,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';

/**
 * Right rail monitoring safety interventions, independent LLM critic decisions,
 * deterministic policy rules, human approvals, and runtime observability metrics.
 */
export function VerificationRail({ session, onReview }) {
  const critic = session.criticResult;
  const policy = session.policyResult;
  const offer = session.currentBestOffer;
  const vendor = session.vendors.find((item) => item.id === offer?.vendorId);
  const review = session.humanReview;
  const blockedEvent = session.events.find((event) => event.type === 'ACTION_BLOCKED');

  return (
    <aside className="right-rail">
      {/* Visual callout when policy/critic actively blocked an unsafe proposal */}
      {blockedEvent && (
        <section className="safety-callout">
          <div className="safety-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <strong>Safety intervention recorded</strong>
            <p>{blockedEvent.message}</p>
            <span>Critic + policy gate prevented an unsafe vendor mutation.</span>
          </div>
        </section>
      )}

      {/* Independent LLM Critic verification status */}
      <section className="panel verification-panel">
        <div className="panel-heading">
          <h3>
            <ShieldCheck size={17} /> Independent critic
          </h3>
        </div>

        {critic ? (
          <div className={`critic-box ${critic.decision.toLowerCase()}`}>
            <div className="critic-title">
              <span className="critic-icon">
                {critic.decision === 'PASS' && <Check size={17} />}
                {critic.decision === 'BLOCK' && <X size={17} />}
                {critic.decision === 'WARN' && '!'}
              </span>
              <strong>{critic.decision}</strong>
            </div>

            <p>
              {critic.decision === 'BLOCK'
                ? critic.policyViolations[0] || 'Unsafe proposal blocked.'
                : critic.concerns[0] || 'Proposal passed independent verification.'}
            </p>

            <div className="evidence-label">Evidence</div>
            {critic.evidence.slice(0, 3).map((item) => (
              <div className="evidence" key={item}>
                {item}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <Sparkles size={16} /> Awaiting critic review…
          </div>
        )}
      </section>

      {/* Deterministic Policy Gate status */}
      <section className="panel policy-panel">
        <div className="panel-heading">
          <h3>Policy gate</h3>
          <StatusBadge
            tone={
              policy?.decision === 'BLOCK'
                ? 'danger'
                : policy?.decision === 'PASS'
                ? 'success'
                : 'blue'
            }
          >
            {policy?.decision || 'Pending'}
          </StatusBadge>
        </div>

        {policy ? (
          <div className="policy-list">
            {policy.evidence.map((item) => (
              <div className="policy-row" key={item}>
                <span>{item}</span>
                <span
                  className={
                    policy.decision === 'BLOCK' && item.includes('Advance')
                      ? 'policy-value bad'
                      : 'policy-value'
                  }
                >
                  {policy.decision === 'PASS' ? (
                    <Check size={15} />
                  ) : policy.decision === 'BLOCK' ? (
                    'Review'
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            Hard constraints will be evaluated here.
          </div>
        )}
      </section>

      {/* Human-in-the-loop review approval modal/card */}
      {review && session.currentState === 'HUMAN_REVIEW' && (
        <section className="panel review-panel">
          <div className="panel-heading">
            <h3>Human review</h3>
            <StatusBadge tone="warning">Required</StatusBadge>
          </div>

          <p className="review-reason">{review.reason}</p>

          <div className="review-detail">
            <span>Current vendor</span>
            <strong>{vendor?.name || '—'}</strong>
          </div>

          <div className="review-detail">
            <span>Proposed action</span>
            <strong>{review.proposedAction.type.replace(/_/g, ' ')}</strong>
          </div>

          <button
            type="button"
            className="primary-button wide"
            onClick={() => onReview('approve')}
          >
            Approve action <Check size={16} />
          </button>

          <div className="review-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => onReview('reject')}
            >
              Reject
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              onClick={() => onReview('stop')}
            >
              Stop
            </button>
          </div>
        </section>
      )}

      {/* Final contract-ready callout */}
      {session.currentState === 'ACCEPTED' && offer && (
        <section className="success-callout">
          <div className="success-circle">
            <Check size={18} />
          </div>
          <div>
            <strong>Procurement completed</strong>
            <p>Contract-ready deal selected with {vendor?.name}.</p>
          </div>
        </section>
      )}

      {/* Real-time telemetry and run observability */}
      <section className="panel observability">
        <div className="panel-heading">
          <h3>Run observability</h3>
          <Activity size={16} color="#7b8ba1" />
        </div>

        <div className="obs-row">
          <span>Confidence</span>
          <strong>{Math.round((session.confidence || 0) * 100)}%</strong>
        </div>

        <div className="obs-row">
          <span>Risk score</span>
          <strong>
            {session.riskScore < 0.35
              ? 'Low'
              : session.riskScore < 0.7
              ? 'Medium'
              : 'High'}{' '}
            · {Math.round(session.riskScore * 100)}%
          </strong>
        </div>

        <div className="obs-row">
          <span>Model runs</span>
          <strong>{session.modelRuns.length}</strong>
        </div>

        <div className="obs-row">
          <span>Events</span>
          <strong>{session.events.length}</strong>
        </div>
      </section>
    </aside>
  );
}
