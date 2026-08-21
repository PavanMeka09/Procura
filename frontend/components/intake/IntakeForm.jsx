'use client';

import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { createProcurement, startProcurement } from '../../lib/api';

/**
 * Natural language procurement requirement intake screen.
 * Allows users to state purchasing constraints and kicks off the autonomous agent workflow.
 */
export function IntakeForm({ onStart }) {
  const [requirementText, setRequirementText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (!requirementText.trim()) return;

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const created = await createProcurement(requirementText);
      const started = await startProcurement(created.request.id);
      onStart(created.request, started.session);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start procurement.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="intake">
      <div className="intake-grid">
        {/* Value proposition & social proof column */}
        <div className="intake-copy">
          <div className="brand-mark">P</div>
          <div className="intake-wordmark">Procura</div>
          <h1>Procurement that knows when to act.</h1>
          <p>
            One agent negotiates. A second agent challenges every consequential proposal.
            Deterministic policy decides what can move forward.
          </p>

          <div className="proof-row">
            <span>
              <ShieldCheck size={16} /> Policy-bounded
            </span>
            <span>
              <Users size={16} /> Multi-vendor
            </span>
            <span>
              <Activity size={16} /> Live trace
            </span>
          </div>
        </div>

        {/* Purchase intake submission card */}
        <form className="intake-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <div>
              <span className="section-kicker">New procurement</span>
              <h2>What do you need to buy?</h2>
            </div>
            <Sparkles size={20} color="#1565d8" />
          </div>

          <label htmlFor="requirement">Purchase requirement</label>
          <textarea
            id="requirement"
            value={requirementText}
            onChange={(event) => setRequirementText(event.target.value)}
            rows={6}
            placeholder="Describe the purchase, budget, delivery and warranty constraints (e.g. Buy 500 business laptops under ₹55,000 each, delivery within 21 days, min 2-year warranty, max 20% advance)."
          />

          {errorMessage && <div className="form-error">{errorMessage}</div>}

          <button
            type="submit"
            className="primary-button wide"
            disabled={isSubmitting || !requirementText.trim()}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={17} className="spin" /> Starting workspace…
              </>
            ) : (
              <>
                Start autonomous procurement <ArrowRight size={17} />
              </>
            )}
          </button>

          <p className="privacy-note">
            Your request stays in the Procura workspace. The backend remains authoritative
            for vendor actions and approvals.
          </p>
        </form>
      </div>
    </main>
  );
}
