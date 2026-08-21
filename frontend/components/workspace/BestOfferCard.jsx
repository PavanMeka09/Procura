'use client';

import React from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { Metric } from '../common/Metric';

function formatCurrency(amount) {
  if (amount == null) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

/**
 * Highlights the active best offer in the negotiation, comparing unit price,
 * total contract value, warranty terms, and advance payment.
 */
export function BestOfferCard({ session }) {
  const offer = session.currentBestOffer;
  const vendor = session.vendors.find((item) => item.id === offer?.vendorId);
  const isAccepted = session.currentState === 'ACCEPTED';

  return (
    <section className="panel best-offer">
      <div className="panel-heading">
        <h3>Current best offer</h3>
        {offer && (
          <StatusBadge tone={isAccepted ? 'success' : 'blue'}>
            {isAccepted ? 'Accepted' : 'Tracking'}
          </StatusBadge>
        )}
      </div>

      {offer ? (
        <div className="best-offer-content">
          {/* Spotlight card for winning proposal */}
          <div className="best-card">
            <div className="best-card-title">
              <strong>{vendor?.name || 'Vendor'}</strong>
              <StatusBadge tone="success">Best offer</StatusBadge>
            </div>

            <div className="best-price">
              {formatCurrency(offer.unitPrice)}
              <small> / unit</small>
            </div>

            <span className="muted">
              Total value ({session.originalRequest.quantity} units)
            </span>
            <strong>{formatCurrency(offer.totalPrice)}</strong>

            <button type="button" className="text-button">
              View offer details <ArrowRight size={14} />
            </button>
          </div>

          {/* Commercial terms breakdown */}
          <div className="offer-facts">
            <Metric
              label="Unit price"
              value={`${formatCurrency(offer.unitPrice)} /unit`}
            />
            <Metric label="Warranty" value={`${offer.warrantyMonths} months`} />
            <Metric
              label="Quantity"
              value={`${session.originalRequest.quantity} units`}
            />
            <Metric
              label="Advance payment"
              value={`${offer.advancePaymentPercent}%`}
            />
            <Metric label="Delivery time" value={`${offer.deliveryDays} days`} />
            <Metric
              label="Validity"
              value={offer.validityDays ? `${offer.validityDays} days` : 'Not specified'}
            />
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <RefreshCw size={18} className="spin" /> Waiting for the first vendor offer…
        </div>
      )}
    </section>
  );
}
