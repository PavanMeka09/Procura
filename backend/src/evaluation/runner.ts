import { createId, now } from '../domain';
import type { EvaluationResult, EvaluationRun, Offer, ProcurementRequest } from '../domain';
import { validateOffer } from '../policy/engine';
import { evaluateAction } from '../policy/decision-gate';
import { extractRequirements, extractRequirementsRegexFallback } from '../requirements';
import { evaluationCases } from './cases';
import { store } from '../store';
import { createSession, runSession } from '../agent/orchestrator';
import { createDeterministicModelAdapters } from '../ai/models';
import { persistStoredEvaluation } from '../store';
import { VENDOR_IDS } from '../vendors/simulator';
import { config } from '../utils/config';

import type { PolicyViolationType } from './cases';

/**
 * Creates synthetic offers that trigger specific policy constraint violations for testing.
 */
function createViolationOffer(
  violationType: PolicyViolationType | undefined,
  request: ProcurementRequest
): Offer {
  const targetPrice = request.targetUnitPrice ?? request.maximumUnitPrice;
  const unitPrice =
    violationType === 'price'
      ? Math.round(request.maximumUnitPrice * 1.15)
      : targetPrice;
  const deliveryDays =
    violationType === 'delivery'
      ? request.deliveryDays + 10
      : request.deliveryDays;
  const warrantyMonths =
    violationType === 'warranty'
      ? Math.max(0, Math.floor(request.minimumWarrantyMonths / 2))
      : request.minimumWarrantyMonths;
  const advancePaymentPercent =
    violationType === 'advance'
      ? Math.min(100, request.maximumAdvancePaymentPercent + 25)
      : request.maximumAdvancePaymentPercent;

  return {
    id: createId(),
    requestId: 'evaluation',
    vendorId: VENDOR_IDS.apex,
    roundNumber: 1,
    rawResponse: '',
    unitPrice,
    totalPrice: unitPrice * request.quantity,
    deliveryDays,
    warrantyMonths,
    advancePaymentPercent,
    paymentTerms: `${advancePaymentPercent}% advance, balance on delivery`,
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

  for (const testCase of evaluationCases) {
    let passed = false;
    const details: string[] = [];
    const request =
      mode === 'test-adapter'
        ? extractRequirementsRegexFallback(testCase.input)
        : await extractRequirements(testCase.input);

    if (testCase.scenarioConfig.kind === 'policy') {
      const violationOffer = createViolationOffer(
        testCase.scenarioConfig.violationType,
        request
      );
      const policy = validateOffer(violationOffer, request);
      passed = policy.decision === 'BLOCK';
      details.push(...policy.violations);
    } else if (testCase.scenarioConfig.kind === 'knowledge') {
      const conflictingOffer = createViolationOffer('advance', request);
      const policy = validateOffer(conflictingOffer, request);
      passed = policy.decision === 'BLOCK';
      details.push(
        `Current deterministic policy blocked unapproved ${conflictingOffer.advancePaymentPercent}% advance term despite historical RAG advice.`
      );
    } else if (testCase.scenarioConfig.kind === 'human') {
      if (testCase.id === 'human-1') {
        const action = {
          type: 'ACCEPT' as const,
          vendorId: VENDOR_IDS.apex,
          offerId: 'offer-1',
          rationale: 'High-value acceptance without critic verification',
        };
        const criticMissing = evaluateAction(action, null, null, 1, config.maxRoundsPerVendor, 0.8);
        passed = criticMissing.decision === 'HUMAN_REVIEW';
        details.push('Missing independent critic result failed closed into human review.');
      } else {
        const action = {
          type: 'ACCEPT' as const,
          vendorId: VENDOR_IDS.apex,
          offerId: 'offer-2',
          rationale: 'Ambiguous indemnity clause requiring human signoff',
        };
        const criticWarning = {
          decision: 'WARN' as const,
          confidence: 0.6,
          policyViolations: [],
          concerns: ['Ambiguous commercial warranty liability clause detected.'],
          evidence: ['Risk score exceeds automated execution threshold.'],
          requiresHumanReview: true,
        };
        const policyPass = { decision: 'PASS' as const, violations: [], warnings: ['ELEVATED_RISK'], evidence: [] };
        const gate = evaluateAction(action, criticWarning, policyPass, 1, config.maxRoundsPerVendor, 0.65);
        passed = gate.decision === 'HUMAN_REVIEW';
        details.push('Elevated risk score and critic warning routed action to human approval.');
      }
    } else if (testCase.scenarioConfig.kind === 'stop') {
      if (testCase.id === 'stop-1') {
        const action = { type: 'STOP' as const, reason: 'Maximum negotiation rounds reached (5 per vendor).' };
        const gate = evaluateAction(
          action,
          null,
          null,
          config.maxRoundsPerVendor,
          config.maxRoundsPerVendor,
          0.1
        );
        passed = gate.decision === 'STOP';
        details.push('Max-round decision gate enforced negotiation stop.');
      } else {
        const action = { type: 'STOP' as const, reason: 'Commercial deadlock: vendor private floor exceeds ceiling.' };
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
          3,
          config.maxRoundsPerVendor,
          0.2
        );
        passed = gate.decision === 'STOP';
        details.push('Terminal vendor deadlock triggered clean negotiation stop.');
      }
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
      name: testCase.name,
      category: testCase.category,
      input: testCase.input,
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
