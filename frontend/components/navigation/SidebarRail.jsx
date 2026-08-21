'use client';

import React from 'react';
import {
  Activity,
  BadgeCheck,
  CircleHelp,
  ChevronDown,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from 'lucide-react';

const NAV_LINKS = [
  { label: 'Control room', icon: LayoutDashboard },
  { label: 'Procurements', icon: FileText },
  { label: 'Vendors', icon: Users },
  { label: 'Policies', icon: ShieldCheck },
  { label: 'Negotiations', icon: Activity },
  { label: 'Approvals', icon: BadgeCheck },
];

/**
 * Left-hand application navigation rail with brand header, action trigger, and profile footer.
 */
export function SidebarRail({ onNew, onEvaluation }) {
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
        {NAV_LINKS.map(({ label, icon: Icon }, index) => (
          <div
            key={label}
            className={`nav-link ${index === 0 ? 'active' : ''}`}
          >
            <Icon size={17} />
            {label}
          </div>
        ))}
        <button
          type="button"
          className="nav-link nav-button"
          onClick={onEvaluation}
        >
          <Activity size={17} />
          Evaluation
        </button>
      </nav>

      {/* User profile & support */}
      <div className="rail-bottom">
        <div className="profile">
          <div className="avatar">PM</div>
          <div>
            <strong>Priya Mehta</strong>
            <span>Procurement Manager</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="support">
          <CircleHelp size={16} /> Help &amp; support
        </div>
      </div>
    </aside>
  );
}
