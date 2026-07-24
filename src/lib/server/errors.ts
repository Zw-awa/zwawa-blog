export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint|foreign key constraint|constraint failed/i.test(message);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isConstraintError(error)) {
    return new AppError(409, "conflict", "数据与现有记录冲突。", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return new AppError(500, "internal_error", "服务器处理请求时发生错误。", {
    cause: error instanceof Error ? error.message : String(error)
  });
}
