'use client';

import React from 'react';

/**
 * Key-value metric display card used across headers, summaries, and evaluation reports.
 */
export function Metric({ label, value, accent = false }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={accent ? 'accent' : ''}>{value}</strong>
    </div>
  );
}
