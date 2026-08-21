/**
 * Custom error hierarchy for domain exceptions across validation, models, critic, and vendors.
 */

export interface ErrorContext {
  requestId?: string;
  sessionId?: string;
  state?: string;
  [key: string]: unknown;
}

export class ApplicationError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;

  constructor(code: string, message: string, context: ErrorContext = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.context = context;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, context: ErrorContext = {}) {
    super('VALIDATION_ERROR', message, context);
  }
}

export class ModelError extends ApplicationError {
  constructor(message: string, context: ErrorContext = {}) {
    super('MODEL_ERROR', message, context);
  }
}

export class CriticError extends ApplicationError {
  constructor(message: string, context: ErrorContext = {}) {
    super('CRITIC_ERROR', message, context);
  }
}

export class VendorError extends ApplicationError {
  constructor(message: string, context: ErrorContext = {}) {
    super('VENDOR_ERROR', message, context);
  }
}

export class PolicyError extends ApplicationError {
  constructor(message: string, context: ErrorContext = {}) {
    super('POLICY_ERROR', message, context);
  }
}
