'use client';

import React from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  FileText,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';

function formatCurrency(amount) {
  if (amount == null) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

/**
 * Right rail monitoring safety interventions, independent LLM critic decisions,
 * deterministic policy rules, human approvals, and runtime observability metrics.
 */
export function VerificationRail({ session, onReview, submittingDecision }) {
  const critic = session.criticResult;
  const policy = session.policyResult;
  const offer = session.currentBestOffer;
  const vendor = session.vendors.find((item) => item.id === offer?.vendorId);
  const review = session.humanReview;
  const reviewVendor = session.vendors.find(
    (item) =>
      item.id ===
      (review?.proposedAction?.vendorId || session.currentVendorId || offer?.vendorId)
  );
  const blockedEvent = session.events.find((event) => event.type === 'ACTION_BLOCKED');
  const proposedAction = review?.proposedAction;
  const proposedTerms = proposedAction?.proposedTerms;

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

      {/* Human-in-the-loop review approval card */}
      {review && session.currentState === 'HUMAN_REVIEW' && (
        <section className="panel review-panel">
          <div className="panel-heading review-heading">
            <h3>
              <ShieldAlert size={17} color="var(--amber)" /> Human review
            </h3>
            <StatusBadge tone="warning">Required</StatusBadge>
          </div>

          <div className="review-content">
            <p className="review-reason">{review.reason}</p>

            <div className="review-meta-box">
              <div className="review-detail">
                <span>Target vendor</span>
                <strong>{reviewVendor?.name || '—'}</strong>
              </div>

              <div className="review-detail">
                <span>Proposed action</span>
                <strong className="action-type-tag">
                  {proposedAction?.type === 'SEND_COUNTER' ? (
                    <>
                      <Send size={12} /> Counteroffer
                    </>
                  ) : proposedAction?.type === 'ACCEPT' ? (
                    <>
                      <Check size={12} /> Accept deal
                    </>
                  ) : (
                    proposedAction?.type?.replace(/_/g, ' ') || 'Action'
                  )}
                </strong>
              </div>
            </div>

            {/* Proposed Commercial Terms breakdown */}
            {proposedTerms && (
              <div className="review-terms-section">
                <div className="review-section-title">Proposed terms</div>
                <div className="review-terms-grid">
                  {proposedTerms.unitPrice != null && (
                    <div className="review-term">
                      <span>Price</span>
                      <strong>{formatCurrency(proposedTerms.unitPrice)}</strong>
                    </div>
                  )}
                  {proposedTerms.advancePaymentPercent != null && (
                    <div className="review-term">
                      <span>Advance</span>
                      <strong>{proposedTerms.advancePaymentPercent}%</strong>
                    </div>
                  )}
                  {proposedTerms.warrantyMonths != null && (
                    <div className="review-term">
                      <span>Warranty</span>
                      <strong>{proposedTerms.warrantyMonths} mo</strong>
                    </div>
                  )}
                  {proposedTerms.deliveryDays != null && (
                    <div className="review-term">
                      <span>Delivery</span>
                      <strong>{proposedTerms.deliveryDays} days</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Drafted counter message preview */}
            {proposedAction?.message && (
              <div className="review-draft-section">
                <div className="review-section-title">
                  <FileText size={12} /> Draft message
                </div>
                <div className="review-draft-box">
                  &ldquo;{proposedAction.message}&rdquo;
                </div>
              </div>
            )}

            {/* Critic warnings & evidence */}
            {review.evidence && review.evidence.length > 0 && (
              <div className="review-evidence-section">
                <div className="review-section-title">
                  <AlertTriangle size={12} /> Verification evidence
                </div>
                <div className="review-evidence-box">
                  {review.evidence.map((item, idx) => (
                    <div className="review-evidence-item" key={idx}>
                      • {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="review-button-group">
              <button
                type="button"
                className="primary-button wide"
                disabled={!!submittingDecision}
                onClick={() => onReview('approve')}
              >
                {submittingDecision === 'approve' ? (
                  <>
                    <RefreshCw size={15} className="spin" /> Approving…
                  </>
                ) : (
                  <>
                    <Check size={16} /> Approve action
                  </>
                )}
              </button>

              <div className="review-actions">
                <button
                  type="button"
                  className="secondary-button warning-button"
                  disabled={!!submittingDecision}
                  onClick={() => onReview('reject')}
                  title="Reject this specific proposal and continue negotiating with other vendors"
                >
                  {submittingDecision === 'reject' ? (
                    <>
                      <RefreshCw size={13} className="spin" /> Rejecting…
                    </>
                  ) : (
                    'Reject action'
                  )}
                </button>
                <button
                  type="button"
                  className="secondary-button danger-button"
                  disabled={!!submittingDecision}
                  onClick={() => onReview('stop')}
                  title="Immediately abort the entire procurement process"
                >
                  {submittingDecision === 'stop' ? (
                    <>
                      <RefreshCw size={13} className="spin" /> Stopping…
                    </>
                  ) : (
                    'Stop all'
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Agent failure diagnostic callout */}
      {session.currentState === 'FAILED' && (
        <section className="panel failure-rail-panel">
          <div className="panel-heading failure-rail-heading">
            <h3>
              <AlertCircle size={17} color="var(--red)" /> Agent failure
            </h3>
            <StatusBadge tone="danger">Failed</StatusBadge>
          </div>
          <div className="failure-rail-content">
            <strong>Stop reason</strong>
            <div className="failure-rail-reason">
              {session.stopReason || 'Unexpected agent failure.'}
            </div>
            <div className="failure-rail-tips">
              <strong>Diagnostics & next steps:</strong>
              <div>• Check backend console logs and AI provider API key status.</div>
              <div>• If using Gemini/OpenRouter, verify quota & rate limits.</div>
              <div>• Click &ldquo;New procurement&rdquo; in the sidebar to retry.</div>
            </div>
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
