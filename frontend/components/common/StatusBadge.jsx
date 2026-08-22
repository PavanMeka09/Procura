'use client';

import React from 'react';

/**
 * Renders a color-coded status badge pill for state indicators.
 * Supported tones: 'blue' | 'success' | 'warning' | 'danger' | 'neutral'.
 */
export function StatusBadge({ children, tone = 'blue' }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
