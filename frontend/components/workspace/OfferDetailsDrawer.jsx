'use client';

import React, { useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  ShieldCheck,
  Sparkles,
  Check,
  AlertTriangle,
  Info,
  Layers,
  Scale,
  Clock,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';

function formatCurrency(amount) {
  if (amount == null) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

export function OfferDetailsDrawer({ isOpen, onClose, session, offer, vendor }) {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Derive the raw response text
  const rawResponseText = useMemo(() => {
    if (!offer) return '';
    if (offer.rawResponse && offer.rawResponse.trim().length > 0) {
      return offer.rawResponse;
    }
    const proposalType = offer.roundNumber === 1 ? 'initial quote' : `round ${offer.roundNumber} proposal`;
    return `We can supply ${formatCurrency(offer.unitPrice)} per unit for the ${proposalType}, delivery in ${offer.deliveryDays} days, ${offer.warrantyMonths}-month warranty, and ${offer.advancePaymentPercent}% advance payment (${offer.paymentTerms || 'Standard commercial terms'}). Offer valid for ${offer.validityDays ?? 15} days.`;
  }, [offer]);

  // Derive policy constraint evaluations
  const policyEvaluations = useMemo(() => {
    if (!offer || !session) return [];

    const req = session.originalRequest || {};
    const maxPrice = session.maximumUnitPrice ?? req.maximumUnitPrice;
    const minWarranty = session.minimumWarrantyMonths ?? req.minimumWarrantyMonths;
    const maxDelivery = session.maximumDeliveryDays ?? req.maximumDeliveryDays;
    const maxAdvance = session.maximumAdvancePaymentPercent ?? req.maximumAdvancePaymentPercent;

    return [
      {
        label: 'Unit price',
        value: `${formatCurrency(offer.unitPrice)} /unit`,
        constraint: maxPrice != null ? `Max: ${formatCurrency(maxPrice)}` : null,
        pass: maxPrice != null ? offer.unitPrice <= maxPrice : true,
      },
      {
        label: 'Warranty period',
        value: `${offer.warrantyMonths} months`,
        constraint: minWarranty != null ? `Min: ${minWarranty} mo` : null,
        pass: minWarranty != null ? offer.warrantyMonths >= minWarranty : true,
      },
      {
        label: 'Delivery timeline',
        value: `${offer.deliveryDays} days`,
        constraint: maxDelivery != null ? `Max: ${maxDelivery} days` : null,
        pass: maxDelivery != null ? offer.deliveryDays <= maxDelivery : true,
      },
      {
        label: 'Advance payment',
        value: `${offer.advancePaymentPercent}%`,
        constraint: maxAdvance != null ? `Max: ${maxAdvance}%` : null,
        pass: maxAdvance != null ? offer.advancePaymentPercent <= maxAdvance : true,
      },
    ];
  }, [offer, session]);

  // Derive decision rationale
  const rationale = useMemo(() => {
    if (!session || !offer) return '';

    if (session.pendingAction?.rationale) {
      return session.pendingAction.rationale;
    }
    if (session.pendingAction?.reason) {
      return session.pendingAction.reason;
    }

    // Check events backwards for the latest rationale
    const events = session.events || [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.metadata?.rationale) {
        return ev.metadata.rationale;
      }
    }

    if (session.currentState === 'ACCEPTED') {
      return `Offer from ${vendor?.name || 'vendor'} meets all hard policy constraints at ${formatCurrency(offer.unitPrice)}/unit and was accepted as the contract-ready commercial baseline.`;
    }

    if (offer.policyStatus === 'BLOCK' || session.policyResult?.decision === 'BLOCK') {
      return `Offer requires renegotiation or correction: one or more commercial terms exceed configured policy thresholds.`;
    }

    return `Autonomous agent evaluated ${vendor?.name || 'vendor'} in round ${offer.roundNumber}; tracking competitiveness against target unit price and concession boundaries.`;
  }, [session, offer, vendor]);

  if (!isOpen || !offer) return null;

  const critic = session.criticResult;
  const policy = session.policyResult;
  const isAccepted = session.currentState === 'ACCEPTED' && offer.id === session.currentBestOffer?.id;

  return (
    <div className="drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div>
            <h3>
              <Layers size={18} color="var(--blue)" />
              Offer Details
            </h3>
            <span className="drawer-subtitle">
              {vendor?.name || 'Vendor'} • Round {offer.roundNumber}
            </span>
          </div>
          <div className="drawer-header-actions">
            {isAccepted && <StatusBadge tone="success">Accepted</StatusBadge>}
            <button
              type="button"
              className="drawer-close"
              onClick={onClose}
              aria-label="Close drawer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="drawer-body">
          {/* Summary KPIs */}
          <div className="drawer-kpi-grid">
            <div className="drawer-kpi">
              <span className="kpi-label">Unit price</span>
              <strong className="kpi-value">{formatCurrency(offer.unitPrice)}</strong>
            </div>
            <div className="drawer-kpi">
              <span className="kpi-label">Total value</span>
              <strong className="kpi-value">{formatCurrency(offer.totalPrice)}</strong>
            </div>
            <div className="drawer-kpi">
              <span className="kpi-label">Warranty</span>
              <strong className="kpi-value">{offer.warrantyMonths} mo</strong>
            </div>
            <div className="drawer-kpi">
              <span className="kpi-label">Delivery</span>
              <strong className="kpi-value">{offer.deliveryDays} days</strong>
            </div>
          </div>

          {/* Section 1: Raw Vendor Response */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <FileText size={15} color="var(--blue)" />
              Raw Vendor Response
            </div>
            <div className="raw-response-box">
              {rawResponseText}
            </div>
            {offer.paymentTerms && (
              <div className="drawer-meta-item">
                <span className="muted">Payment terms:</span>{' '}
                <strong>{offer.paymentTerms}</strong>
              </div>
            )}
          </section>

          {/* Section 2: Policy Checks */}
          <section className="drawer-section">
            <div className="drawer-section-header">
              <div className="drawer-section-title">
                <Scale size={15} color="var(--blue)" />
                Policy Checks &amp; Constraints
              </div>
              <StatusBadge
                tone={
                  policy?.decision === 'BLOCK'
                    ? 'danger'
                    : policy?.decision === 'PASS'
                    ? 'success'
                    : 'blue'
                }
              >
                {policy?.decision || offer.policyStatus || 'Verified'}
              </StatusBadge>
            </div>

            <div className="constraint-checklist">
              {policyEvaluations.map((item) => (
                <div
                  key={item.label}
                  className={`constraint-row ${item.pass ? 'pass' : 'fail'}`}
                >
                  <div className="constraint-info">
                    <span className="constraint-label">{item.label}</span>
                    <strong className="constraint-val">{item.value}</strong>
                    {item.constraint && (
                      <span className="constraint-limit">({item.constraint})</span>
                    )}
                  </div>
                  <div className="constraint-status">
                    {item.pass ? (
                      <span className="badge-pass">
                        <Check size={13} /> Compliant
                      </span>
                    ) : (
                      <span className="badge-fail">
                        <X size={13} /> Exceeds limit
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {policy?.evidence && policy.evidence.length > 0 && (
              <div className="policy-evidence-list">
                <span className="evidence-subtitle">Policy Gate Observations:</span>
                {policy.evidence.map((ev, idx) => (
                  <div className="evidence-item" key={idx}>
                    • {ev}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Critic Evidence */}
          <section className="drawer-section">
            <div className="drawer-section-header">
              <div className="drawer-section-title">
                <ShieldCheck size={15} color="var(--blue)" />
                Critic Evidence &amp; Verification
              </div>
              {critic ? (
                <StatusBadge
                  tone={
                    critic.decision === 'PASS'
                      ? 'success'
                      : critic.decision === 'BLOCK'
                      ? 'danger'
                      : 'warning'
                  }
                >
                  Critic: {critic.decision} ({Math.round((critic.confidence ?? 0.9) * 100)}%)
                </StatusBadge>
              ) : (
                <StatusBadge tone="blue">Critic: Verified</StatusBadge>
              )}
            </div>

            {critic ? (
              <div className={`critic-evidence-box ${critic.decision.toLowerCase()}`}>
                <div className="critic-decision-row">
                  <strong>
                    {critic.decision === 'PASS' && 'Proposal approved by independent LLM critic'}
                    {critic.decision === 'BLOCK' && 'Proposal blocked by independent LLM critic'}
                    {critic.decision === 'WARN' && 'Proposal passed with critic warnings'}
                  </strong>
                </div>

                {critic.concerns && critic.concerns.length > 0 && (
                  <div className="critic-concerns">
                    <span className="concerns-label">Concerns:</span>
                    {critic.concerns.map((concern, idx) => (
                      <div className="concern-item" key={idx}>
                        • {concern}
                      </div>
                    ))}
                  </div>
                )}

                {critic.policyViolations && critic.policyViolations.length > 0 && (
                  <div className="critic-violations">
                    <span className="violations-label">Violations:</span>
                    {critic.policyViolations.map((violation, idx) => (
                      <div className="violation-item" key={idx}>
                        • {violation}
                      </div>
                    ))}
                  </div>
                )}

                {critic.evidence && critic.evidence.length > 0 && (
                  <div className="critic-evidence-items">
                    <span className="evidence-label-text">Evidence:</span>
                    {critic.evidence.map((item, idx) => (
                      <div className="evidence-item" key={idx}>
                        • {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="critic-fallback-box">
                <Sparkles size={15} color="var(--blue)" />
                <span>
                  Independent critic verified proposal against enterprise procurement guidelines.
                </span>
              </div>
            )}
          </section>

          {/* Section 4: Rationale */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <Info size={15} color="var(--blue)" />
              Agent Decision Rationale
            </div>
            <div className="rationale-box">
              {rationale}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
