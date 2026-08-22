'use client';

import React, { useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { runEvaluation } from '../../lib/api';
import { StatusBadge } from '../common/StatusBadge';
import { Metric } from '../common/Metric';

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Automated 20-case test evaluation lab for measuring policy compliance, safety scores,
 * error recovery rates, and escalation accuracy.
 */
export function EvaluationLab() {
  const [run, setRun] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [executionMode, setExecutionMode] = useState('test-adapter');

  async function handleExecute() {
    setIsExecuting(true);
    setErrorMessage('');

    try {
      const result = await runEvaluation(executionMode);
      setRun(result.run);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Evaluation run failed.');
    } finally {
      setIsExecuting(false);
    }
  }

  const metricItems = run
    ? [
        { label: 'Policy compliance', value: run.metrics.policyCompliance },
        { label: 'Safety score', value: run.metrics.safetyScore },
        { label: 'Recovery rate', value: run.metrics.recoveryRate },
        { label: 'Escalation accuracy', value: run.metrics.escalationAccuracy },
        { label: 'Stop accuracy', value: run.metrics.stopAccuracy },
      ]
    : [];

  return (
    <div className="evaluation-view">
      {/* Hero header with execute action */}
      <section className="evaluation-hero">
        <div>
          <span className="section-kicker">Quality assurance</span>
          <h2>Evaluation lab</h2>
          <p>
            Run the 20-case procurement suite and inspect the assertions that actually executed.
          </p>
        </div>

        <div className="evaluation-actions">
          <label className="evaluation-mode">
            <span>Execution mode</span>
            <select
              value={executionMode}
              disabled={isExecuting}
              onChange={(event) => setExecutionMode(event.target.value)}
            >
              <option value="test-adapter">Offline test adapter (20 cases · ~1s)</option>
              <option value="provider-quick">Live quick sample (5 core cases · ~6-8s)</option>
              <option value="provider">Full live provider suite (20 cases · parallel)</option>
            </select>
          </label>

          <button
            type="button"
            className="primary-button"
            disabled={isExecuting}
            onClick={handleExecute}
          >
            {isExecuting ? (
              <>
                <RefreshCw size={16} className="spin" /> Running suite…
              </>
            ) : (
              <>
                Run evaluation <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </section>

      {errorMessage && <div className="form-error">{errorMessage}</div>}

      {run && (
        <>
          {/* Top level counts */}
          <section className="evaluation-summary">
            <Metric label="Total cases" value={run.total} />
            <Metric label="Passed" value={run.passed} />
            <Metric label="Failed" value={run.failed} />
            <Metric
              label="Execution"
              value={
                run.executionMode === 'test-adapter'
                  ? 'Offline test adapter'
                  : run.executionMode === 'provider-quick'
                  ? 'Live quick sample'
                  : 'Live providers'
              }
            />
          </section>

          {/* Aggregate percentage metrics */}
          <section className="panel metric-panel">
            <div className="panel-heading">
              <h3>Evaluation metrics</h3>
              <StatusBadge tone={run.failed ? 'warning' : 'success'}>
                {run.failed ? 'Needs review' : 'All assertions passed'}
              </StatusBadge>
            </div>

            <div className="evaluation-metrics">
              {metricItems.map(({ label, value }) => {
                const percent = Math.round(Number(value) * 100);

                return (
                  <div className="eval-metric" key={label}>
                    <span>{label}</span>
                    <strong>{percent}%</strong>
                    <div className="metric-track">
                      <i style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Granular per-case assertion table */}
          <section className="panel case-panel">
            <div className="panel-heading">
              <h3>Per-case results</h3>
              <span className="muted">Executed {formatTime(run.createdAt)}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Expected</th>
                    <th>Result</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((result) => (
                    <tr key={result.caseId}>
                      <td style={{ minWidth: '180px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong>{result.caseId}</strong>
                          {result.category && (
                            <StatusBadge tone="neutral">
                              {result.category}
                            </StatusBadge>
                          )}
                        </div>
                        {result.name && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #999)', marginTop: '3px' }}>
                            {result.name}
                          </div>
                        )}
                      </td>
                      <td>{result.expectedBehavior}</td>
                      <td>
                        <StatusBadge tone={result.passed ? 'success' : 'danger'}>
                          {result.passed ? 'Passed' : 'Failed'}
                        </StatusBadge>
                      </td>
                      <td style={{ fontSize: '0.86rem' }}>{result.details.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
