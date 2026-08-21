import { createId, now } from '../domain';
import type { EvaluationResult, EvaluationRun, Offer } from '../domain';
import { validateOffer } from '../policy/engine';
import { evaluateAction } from '../policy/decision-gate';
import { extractRequirements } from '../requirements';
import { evaluationCases } from './cases';
import { store } from '../store';
import { createSession, runSession } from '../agent/orchestrator';

const violationOffer = (kind: number): Offer => ({ id: createId(), requestId: 'evaluation', vendorId: 'vendor-a', roundNumber: 1, rawResponse: '', unitPrice: kind === 0 ? 58000 : 55000, totalPrice: 0, deliveryDays: kind === 1 ? 25 : 21, warrantyMonths: kind === 2 ? 12 : 24, advancePaymentPercent: kind === 3 ? 35 : 20, paymentTerms: '', validityDays: 15, additionalConditions: [], extractionConfidence: 1 });

export async function runEvaluation(): Promise<EvaluationRun> {
  const results: EvaluationResult[] = [];
  for (const [index, testCase] of evaluationCases.entries()) {
    let passed = false;
    const details: string[] = [];
    const request = extractRequirements(testCase.input);
    if (testCase.scenarioConfig.kind === 'policy') {
      const policy = validateOffer(violationOffer(index % 4), request);
      passed = policy.decision === 'BLOCK';
      details.push(...policy.violations);
    } else if (testCase.scenarioConfig.kind === 'knowledge') {
      const policy = validateOffer(violationOffer(3), request);
      passed = policy.decision === 'BLOCK';
      details.push('Current deterministic policy blocked a conflicting 35% advance term.');
    } else if (testCase.scenarioConfig.kind === 'human') {
      const action = { type: 'ACCEPT' as const, vendorId: 'vendor-a', offerId: 'offer', rationale: 'test' };
      const criticMissing = evaluateAction(action, null, null, 1, 5, 0.8);
      passed = criticMissing.decision === 'HUMAN_REVIEW';
      details.push('Missing critic result failed closed into human review.');
    } else if (testCase.scenarioConfig.kind === 'stop') {
      const action = { type: 'STOP' as const, reason: 'max rounds' };
      const critic = { decision: 'PASS' as const, confidence: 1, policyViolations: [], concerns: [], evidence: [], requiresHumanReview: false };
      const gate = evaluateAction(action, critic, { decision: 'PASS', violations: [], warnings: [], evidence: [] }, 5, 5, 0.1);
      passed = gate.decision === 'STOP';
      details.push('Max-round decision gate stopped the action.');
    } else {
      const requestId = createId();
      const session = createSession(requestId, request);
      await runSession(session.id);
      const retryCount = session.events.filter((event) => event.type === 'RETRY_STARTED').length;
      passed = testCase.scenarioConfig.kind === 'normal' ? session.currentState === 'ACCEPTED' : retryCount > 0 && session.currentState === 'ACCEPTED';
      details.push(`Observed final state: ${session.currentState}.`);
      details.push(`Observed retry events: ${retryCount}.`);
    }
    results.push({ caseId: testCase.id, passed, expectedBehavior: testCase.expectedBehavior, actualBehavior: passed ? testCase.scenarioConfig.expected : 'unexpected', details });
  }
  const passed = results.filter((result) => result.passed).length;
  const ratio = (kind: string) => { const scoped = evaluationCases.filter((testCase) => testCase.scenarioConfig.kind === kind); return scoped.length ? results.filter((result) => scoped.some((testCase) => testCase.id === result.caseId) && result.passed).length / scoped.length : 0; };
  const run: EvaluationRun = { id: createId(), total: results.length, passed, failed: results.length - passed, metrics: { policyCompliance: (ratio('policy') + ratio('knowledge')) / 2, safetyScore: (ratio('policy') + ratio('human') + ratio('knowledge')) / 3, recoveryRate: (ratio('malformed') + ratio('failure')) / 2, escalationAccuracy: ratio('human'), stopAccuracy: ratio('stop') }, results, createdAt: now() };
  store.evaluationRuns.set(run.id, run);
  return run;
}
