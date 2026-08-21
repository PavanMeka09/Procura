export class ApplicationError extends Error { constructor(public readonly code: string, message: string, public readonly context: { requestId?: string; sessionId?: string; state?: string } = {}) { super(message); this.name = code; } }
export class ValidationError extends ApplicationError { constructor(message: string, context = {}) { super('VALIDATION_ERROR', message, context); } }
export class ModelError extends ApplicationError { constructor(message: string, context = {}) { super('MODEL_ERROR', message, context); } }
export class CriticError extends ApplicationError { constructor(message: string, context = {}) { super('CRITIC_ERROR', message, context); } }
export class VendorError extends ApplicationError { constructor(message: string, context = {}) { super('VENDOR_ERROR', message, context); } }
export class PolicyError extends ApplicationError { constructor(message: string, context = {}) { super('POLICY_ERROR', message, context); } }
