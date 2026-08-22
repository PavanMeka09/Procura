'use client';

import React from 'react';
import {
  Activity,
  LayoutDashboard,
} from 'lucide-react';

const NAV_LINKS = [
  { id: 'control', label: 'Control room', icon: LayoutDashboard },
  { id: 'evaluation', label: 'Evaluation', icon: Activity },
];

/**
 * Left-hand application navigation rail with brand header, action trigger, and view switcher.
 */
export function SidebarRail({ activeView = 'control', onSelectView, onNew }) {
  const handleSelect = (viewId) => {
    if (onSelectView) {
      onSelectView(viewId);
    }
  };

  return (
    <aside className="rail">
      {/* Brand mark and title */}
      <div className="rail-brand">
        <div className="brand-mark small">P</div>
        <div>
          <div className="rail-wordmark">Procura</div>
          <div className="rail-subtitle">Autonomous procurement</div>
        </div>
      </div>

      {/* Primary intake action */}
      <button type="button" className="new-button" onClick={onNew}>
        <span>+</span> New procurement
      </button>

      {/* Navigation links */}
      <nav>
        {NAV_LINKS.map(({ id, label, icon: Icon }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              type="button"
              className={`nav-link nav-button ${isActive ? 'active' : ''}`}
              onClick={() => handleSelect(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
