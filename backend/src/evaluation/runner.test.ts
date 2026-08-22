import { describe, expect, test } from 'bun:test';
import { QUICK_SAMPLE_CASE_IDS, evaluationCases } from './cases';
import { runEvaluation } from './runner';

describe('20-Case Evaluation Suite & Harness', () => {
  test('all 20 test cases have unique, heterogeneous inputs and domains', () => {
    expect(evaluationCases).toHaveLength(20);

    const inputs = new Set<string>();
    const names = new Set<string>();
    const ids = new Set<string>();

    for (const testCase of evaluationCases) {
      expect(testCase.input.length).toBeGreaterThan(15);
      expect(testCase.name.length).toBeGreaterThan(5);
      expect(testCase.category.length).toBeGreaterThan(3);

      inputs.add(testCase.input);
      names.add(testCase.name);
      ids.add(testCase.id);
    }

    // Zero duplicate inputs - completely diversified suite
    expect(inputs.size).toBe(20);
    expect(names.size).toBe(20);
    expect(ids.size).toBe(20);
  });

  test(
    'executes full 20-case evaluation suite with 100% pass rate in test-adapter mode',
    async () => {
      const run = await runEvaluation('test-adapter');

      expect(run.total).toBe(20);
      expect(run.passed).toBe(20);
      expect(run.failed).toBe(0);
      expect(run.results).toHaveLength(20);

      // Verify every assertion passed
      for (const result of run.results) {
        expect(result.passed).toBe(true);
        expect(result.details.length).toBeGreaterThan(0);
      }

      // Verify aggregate metrics
      expect(run.metrics.policyCompliance).toBe(1.0);
      expect(run.metrics.safetyScore).toBe(1.0);
      expect(run.metrics.recoveryRate).toBe(1.0);
      expect(run.metrics.escalationAccuracy).toBe(1.0);
      expect(run.metrics.stopAccuracy).toBe(1.0);
    },
    30000
  );

  test('quick sample benchmark case IDs are valid and cover core categories', () => {
    expect(QUICK_SAMPLE_CASE_IDS).toHaveLength(5);
    const caseMap = new Map(evaluationCases.map((c) => [c.id, c]));

    const sampledCategories = new Set<string>();
    for (const sampleId of QUICK_SAMPLE_CASE_IDS) {
      const foundCase = caseMap.get(sampleId);
      expect(foundCase).toBeDefined();
      if (foundCase) {
        sampledCategories.add(foundCase.scenarioConfig.kind);
      }
    }

    // Ensures quick sample spans 5 distinct core scenario kinds
    expect(sampledCategories.size).toBe(5);
  });
});
