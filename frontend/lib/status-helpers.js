/**
 * Status tone and label definitions for negotiation states.
 */
export function getSessionStatusInfo(currentState) {
  switch (currentState) {
    case 'ACCEPTED':
      return {
        tone: 'success',
        bannerText: 'Procurement complete',
        badgeLabel: 'FINAL ACCEPTED',
        isFinalAccepted: true,
        isUnderHumanReview: false,
        isFailed: false,
        isStopped: false,
      };
    case 'HUMAN_REVIEW':
      return {
        tone: 'warning',
        bannerText: 'Waiting for approval',
        badgeLabel: 'HUMAN REVIEW',
        isFinalAccepted: false,
        isUnderHumanReview: true,
        isFailed: false,
        isStopped: false,
      };
    case 'FAILED':
      return {
        tone: 'danger',
        bannerText: 'Negotiation failed',
        badgeLabel: 'FAILED',
        isFinalAccepted: false,
        isUnderHumanReview: false,
        isFailed: true,
        isStopped: false,
      };
    case 'STOPPED':
      return {
        tone: 'warning',
        bannerText: 'Negotiation stopped',
        badgeLabel: 'STOPPED',
        isFinalAccepted: false,
        isUnderHumanReview: false,
        isFailed: false,
        isStopped: true,
      };
    default:
      return {
        tone: 'blue',
        bannerText: 'Agent is negotiating',
        badgeLabel: currentState ? currentState.replace(/_/g, ' ') : 'NEGOTIATING',
        isFinalAccepted: false,
        isUnderHumanReview: false,
        isFailed: false,
        isStopped: false,
      };
  }
}

/**
 * Maps timeline events and critic decisions to semantic color tones.
 */
export function resolveTimelineEventTone(eventType, event) {
  if (eventType === 'AGENT_FAILED') {
    return 'danger';
  }

  if (eventType === 'NEGOTIATION_STOPPED') {
    return 'warning';
  }

  if (eventType === 'CRITIC_RESULT') {
    const decision = event?.metadata?.decision;
    if (decision === 'PASS') return 'success';
    if (decision === 'WARN') return 'warning';
    return 'danger';
  }

  if (['DEAL_ACCEPTED', 'POLICY_RESULT', 'HUMAN_APPROVED'].includes(eventType)) {
    return 'success';
  }

  if (['ACTION_BLOCKED', 'HUMAN_REVIEW_REQUIRED', 'HUMAN_REJECTED'].includes(eventType)) {
    return 'warning';
  }

  return 'blue';
}
