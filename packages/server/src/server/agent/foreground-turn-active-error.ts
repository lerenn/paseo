/** Thrown by a provider session when startTurn is called while it still holds a foreground turn. */
export class ForegroundTurnActiveError extends Error {
  constructor() {
    super("A foreground turn is already active");
    this.name = "ForegroundTurnActiveError";
  }
}

export function isForegroundTurnActiveError(error: unknown): error is ForegroundTurnActiveError {
  return error instanceof ForegroundTurnActiveError;
}
