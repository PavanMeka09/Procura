'use client';

import React from 'react';
import { Clock3, Laptop } from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { Metric } from '../common/Metric';
import { getSessionStatusInfo } from '../../lib/status-helpers';

function formatCurrency(amount) {
  if (amount == null) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Top panel displaying request requirements, baseline constraints, and overall session status.
 */
export function RequestHeader({ session }) {
  const request = session.originalRequest;
  const { tone: badgeTone, badgeLabel } = getSessionStatusInfo(session.currentState);

  return (
    <section className="request-header panel">
      {/* Title & metadata bar */}
      <div className="request-title">
        <div>
          <h2>
            {request.item} procurement <span className="request-id">/ live workspace</span>
          </h2>
          <div className="request-meta">
            <span>
              <Laptop size={15} /> Category: {request.item}
            </span>
            <span>
              <Clock3 size={15} /> Started {formatTime(session.startedAt)}
            </span>
          </div>
        </div>

        <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
      </div>

      {/* Constraints metric strip */}
      <div className="metric-grid">
        <Metric
          label="Target price"
          value={`${formatCurrency(request.targetUnitPrice)} / unit`}
        />
        <Metric label="Quantity" value={`${request.quantity} units`} />
        <Metric label="Delivery time" value={`${request.deliveryDays} days`} />
        <Metric label="Warranty" value={`${request.minimumWarrantyMonths} months`} />
        <Metric
          label="Advance payment (max)"
          value={`${request.maximumAdvancePaymentPercent}%`}
        />
      </div>
    </section>
  );
}
