'use client';

import React from 'react';
import { StatusBadge } from '../common/StatusBadge';

/**
 * Side-by-side vendor comparison matrix displaying best offers per vendor
 * alongside policy compliance status.
 */
export function VendorComparisonTable({ session }) {
  const vendorRows = session.vendors.map((vendor) => {
    const offers = session.offers.filter((offer) => offer.vendorId === vendor.id);
    const bestVendorOffer = offers.sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const isGlobalBest = bestVendorOffer?.id === session.currentBestOffer?.id;

    return {
      vendor,
      offer: bestVendorOffer,
      isBest: isGlobalBest,
    };
  });

  return (
    <section className="panel vendor-panel">
      <div className="panel-heading">
        <h3>Vendor comparison</h3>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Unit price (₹)</th>
              <th>Delivery (days)</th>
              <th>Warranty</th>
              <th>Advance</th>
              <th>Total value (₹)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {vendorRows.map(({ vendor, offer, isBest }) => {
              const isBlocked = offer?.policyStatus === 'BLOCK';
              const isAccepted = isBest && session.currentState === 'ACCEPTED';

              const badgeTone = isBlocked
                ? 'danger'
                : isAccepted
                ? 'success'
                : 'blue';

              const badgeText = isBlocked
                ? 'Blocked'
                : isAccepted
                ? 'Accepted'
                : offer
                ? 'Considered'
                : 'Waiting';

              return (
                <tr key={vendor.id} className={isBest ? 'best-row' : ''}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong>{vendor.name}</strong>
                      {isBest && <span className="best-tag">Best</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: '2px' }}>
                      {vendor.channel || (vendor.vendorType === 'http_api' ? 'External REST API' : 'Autonomous AI Agent')}
                    </div>
                  </td>
                  <td>{offer ? offer.unitPrice.toLocaleString('en-IN') : '—'}</td>
                  <td>{offer?.deliveryDays ?? '—'}</td>
                  <td>{offer ? `${offer.warrantyMonths} mo` : '—'}</td>
                  <td>{offer ? `${offer.advancePaymentPercent}%` : '—'}</td>
                  <td>{offer ? offer.totalPrice.toLocaleString('en-IN') : '—'}</td>
                  <td>
                    <StatusBadge tone={badgeTone}>{badgeText}</StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
