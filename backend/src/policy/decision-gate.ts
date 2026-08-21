import type { AgentAction, CriticResult, PolicyResult, DecisionResult } from '../domain';
export function evaluateAction(action: AgentAction, critic: CriticResult | null, policy: PolicyResult | null, currentRound: number, maxRounds: number, riskScore: number): DecisionResult {
  if (currentRound >= maxRounds) return { decision: 'STOP', reason: `Maximum negotiation rounds reached (${maxRounds}).` };
  if (!critic) return { decision: 'HUMAN_REVIEW', reason: 'Independent critic result is unavailable; consequential action is held.' };
  if (policy?.decision === 'BLOCK' || critic.decision === 'BLOCK') return { decision: 'BLOCK', reason: [...(policy?.violations ?? []), ...critic.policyViolations].join(' ') || 'Verification blocked the proposed action.' };
  if (policy?.decision === 'HUMAN_REVIEW' || critic.requiresHumanReview || (critic.decision === 'WARN' && riskScore >= 0.55)) return { decision: 'HUMAN_REVIEW', reason: 'Verification identified a risk that requires human approval.' };
  if (action.type === 'STOP') return { decision: 'STOP', reason: action.reason };
  return { decision: 'EXECUTE', reason: 'Independent critic passed and deterministic policy passed.' };
}
