export type RetryInput = {
  status?: number;
  message?: string;
  attempt: number;
  allowRetry: boolean;
  hasIdempotencyKey: boolean;
};

/** Managed calls must not retry a request the provider may already have accepted. */
export function retryDecision(input: RetryInput): "retry" | "fail" {
  if (!input.allowRetry || input.attempt >= 1) return "fail";
  const status = input.status ?? 0;
  const message = input.message ?? "";
  const rateLimited = status === 429;
  const serverError = status >= 500;
  const transport = /timeout|network|fetch|aborted/i.test(message);
  if (!rateLimited && !serverError && !transport) return "fail";
  if ((serverError || transport) && !input.hasIdempotencyKey) return "fail";
  return "retry";
}
