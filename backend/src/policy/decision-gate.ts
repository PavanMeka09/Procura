import type {
  AgentAction,
  CriticResult,
  PolicyResult,
  DecisionResult,
} from '../domain';

/**
 * Evaluates whether a proposed agent action can be executed, blocked, held for human review, or stopped.
 *
 * Implements a fail-closed safety gate:
 * 1. Max round exhaustion forces a negotiation STOP.
 * 2. Missing critic evaluations fail-closed into HUMAN_REVIEW.
 * 3. Any BLOCK by either the deterministic policy or LLM critic immediately blocks the action.
 * 4. High-risk warning states or explicit escalation requests route to HUMAN_REVIEW.
 */
export function evaluateAction(
  action: AgentAction,
  critic: CriticResult | null,
  policy: PolicyResult | null,
  currentRound: number,
  maxRounds: number,
  riskScore: number
): DecisionResult {
  // Guard 1: Enforce hard ceiling on negotiation rounds
  if (currentRound >= maxRounds) {
    return {
      decision: 'STOP',
      reason: `Maximum negotiation rounds reached (${maxRounds}).`,
    };
  }

  // Guard 2: Critic failure is fail-closed
  if (!critic) {
    return {
      decision: 'HUMAN_REVIEW',
      reason: 'Independent critic result is unavailable; consequential action is held.',
    };
  }

  // Guard 3: Hard deterministic policy or critic block
  if (policy?.decision === 'BLOCK' || critic.decision === 'BLOCK') {
    const combinedViolations = [
      ...(policy?.violations ?? []),
      ...critic.policyViolations,
    ];

    return {
      decision: 'BLOCK',
      reason: combinedViolations.join(' ') || 'Verification blocked the proposed action.',
    };
  }

  // Guard 4: Escalate to human if flagged by policy, critic, or elevated composite risk score
  const isHighRiskWarning = critic.decision === 'WARN' && riskScore >= 0.55;
  if (policy?.decision === 'HUMAN_REVIEW' || critic.requiresHumanReview || isHighRiskWarning) {
    return {
      decision: 'HUMAN_REVIEW',
      reason: 'Verification identified a risk that requires human approval.',
    };
  }

  // Guard 5: Stop command issued directly
  if (action.type === 'STOP') {
    return {
      decision: 'STOP',
      reason: action.reason,
    };
  }

  // Safe to proceed
  return {
    decision: 'EXECUTE',
    reason: 'Independent critic passed and deterministic policy passed.',
  };
}
