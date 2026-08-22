'use client';

import React from 'react';
import {
  Activity,
  BadgeCheck,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from 'lucide-react';

const NAV_LINKS = [
  { id: 'control', label: 'Control room', icon: LayoutDashboard },
  { id: 'procurements', label: 'Procurements', icon: FileText },
  { id: 'vendors', label: 'Vendors', icon: Users },
  { id: 'policies', label: 'Policies', icon: ShieldCheck },
  { id: 'negotiations', label: 'Negotiations', icon: Activity },
  { id: 'approvals', label: 'Approvals', icon: BadgeCheck },
];

/**
 * Left-hand application navigation rail with brand header, action trigger, and view switcher.
 */
export function SidebarRail({ activeView = 'control', onSelectView, onNew, onEvaluation }) {
  const handleSelect = (viewId) => {
    if (onSelectView) {
      onSelectView(viewId);
    } else if (viewId === 'evaluation' && onEvaluation) {
      onEvaluation();
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
        <button
          type="button"
          className={`nav-link nav-button ${activeView === 'evaluation' ? 'active' : ''}`}
          onClick={() => handleSelect('evaluation')}
        >
          <Activity size={17} />
          Evaluation
        </button>
      </nav>
    </aside>
  );
}
