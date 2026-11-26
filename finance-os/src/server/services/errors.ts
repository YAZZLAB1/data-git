/** An error whose message is safe and useful to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; field?: string };
