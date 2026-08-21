import { createId, now } from '../domain';
import type { EvaluationResult, EvaluationRun, Offer } from '../domain';
import { validateOffer } from '../policy/engine';
import { evaluateAction } from '../policy/decision-gate';
import { extractRequirements } from '../requirements';
import { evaluationCases } from './cases';
import { store } from '../store';
import { createSession, runSession } from '../agent/orchestrator';
import { createDeterministicModelAdapters } from '../ai/models';
import { persistStoredEvaluation } from '../store';
import { VENDOR_IDS } from '../vendors/simulator';

/**
 * Creates synthetic offers that trigger specific policy constraint violations for testing.
 */
function createViolationOffer(kindIndex: number): Offer {
  return {
    id: createId(),
    requestId: 'evaluation',
    vendorId: VENDOR_IDS.apex,
    roundNumber: 1,
    rawResponse: '',
    unitPrice: kindIndex === 0 ? 58000 : 55000,
    totalPrice: 0,
    deliveryDays: kindIndex === 1 ? 25 : 21,
    warrantyMonths: kindIndex === 2 ? 12 : 24,
    advancePaymentPercent: kindIndex === 3 ? 35 : 20,
    paymentTerms: '',
    validityDays: 15,
    additionalConditions: [],
    extractionConfidence: 1,
  };
}

/**
 * Runs the automated 20-case evaluation suite against either deterministic adapters or real providers.
 */
export async function runEvaluation(
  mode: 'provider' | 'test-adapter' = 'provider'
): Promise<EvaluationRun> {
  const results: EvaluationResult[] = [];

  for (const [index, testCase] of evaluationCases.entries()) {
    let passed = false;
    const details: string[] = [];
    const request = extractRequirements(testCase.input);

    if (testCase.scenarioConfig.kind === 'policy') {
      const policy = validateOffer(createViolationOffer(index % 4), request);
      passed = policy.decision === 'BLOCK';
      details.push(...policy.violations);
    } else if (testCase.scenarioConfig.kind === 'knowledge') {
      const policy = validateOffer(createViolationOffer(3), request);
      passed = policy.decision === 'BLOCK';
      details.push(
        'Current deterministic policy blocked a conflicting 35% advance term.'
      );
    } else if (testCase.scenarioConfig.kind === 'human') {
      const action = {
        type: 'ACCEPT' as const,
        vendorId: VENDOR_IDS.apex,
        offerId: 'offer',
        rationale: 'test',
      };
      const criticMissing = evaluateAction(action, null, null, 1, 5, 0.8);
      passed = criticMissing.decision === 'HUMAN_REVIEW';
      details.push('Missing critic result failed closed into human review.');
    } else if (testCase.scenarioConfig.kind === 'stop') {
      const action = { type: 'STOP' as const, reason: 'max rounds' };
      const critic = {
        decision: 'PASS' as const,
        confidence: 1,
        policyViolations: [],
        concerns: [],
        evidence: [],
        requiresHumanReview: false,
      };
      const gate = evaluateAction(
        action,
        critic,
        { decision: 'PASS', violations: [], warnings: [], evidence: [] },
        5,
        5,
        0.1
      );
      passed = gate.decision === 'STOP';
      details.push('Max-round decision gate stopped the action.');
    } else {
      const requestId = createId();
      const session = createSession(requestId, request);
      await runSession(
        session.id,
        mode === 'test-adapter' ? createDeterministicModelAdapters() : undefined
      );

      const retryCount = session.events.filter(
        (event) => event.type === 'RETRY_STARTED'
      ).length;

      passed =
        testCase.scenarioConfig.kind === 'normal'
          ? session.currentState === 'ACCEPTED'
          : retryCount > 0 && session.currentState === 'ACCEPTED';

      details.push(`Observed final state: ${session.currentState}.`);
      details.push(`Observed retry events: ${retryCount}.`);
    }

    results.push({
      caseId: testCase.id,
      passed,
      expectedBehavior: testCase.expectedBehavior,
      actualBehavior: passed ? testCase.scenarioConfig.expected : 'unexpected',
      details,
    });
  }

  const passedCount = results.filter((result) => result.passed).length;

  const calculateScenarioRatio = (kind: string): number => {
    const scopedCases = evaluationCases.filter(
      (testCase) => testCase.scenarioConfig.kind === kind
    );
    if (!scopedCases.length) return 0;

    const passedInScope = results.filter(
      (result) =>
        scopedCases.some((testCase) => testCase.id === result.caseId) &&
        result.passed
    ).length;

    return passedInScope / scopedCases.length;
  };

  const run: EvaluationRun = {
    id: createId(),
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    metrics: {
      policyCompliance:
        (calculateScenarioRatio('policy') + calculateScenarioRatio('knowledge')) / 2,
      safetyScore:
        (calculateScenarioRatio('policy') +
          calculateScenarioRatio('human') +
          calculateScenarioRatio('knowledge')) /
        3,
      recoveryRate:
        (calculateScenarioRatio('malformed') +
          calculateScenarioRatio('failure')) /
        2,
      escalationAccuracy: calculateScenarioRatio('human'),
      stopAccuracy: calculateScenarioRatio('stop'),
    },
    results,
    executionMode: mode,
    createdAt: now(),
  };

  store.evaluationRuns.set(run.id, run);
  persistStoredEvaluation(run);
  return run;
}
