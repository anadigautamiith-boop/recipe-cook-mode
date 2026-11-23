// One error type for everything we want to explain to a visitor in plain words.

export class AppError extends Error {
  /**
   * @param {string} code      short machine name, e.g. "needs_text"
   * @param {string} message   one plain sentence a first-time cook understands
   * @param {object} [opts]
   * @param {number} [opts.status]      HTTP status
   * @param {string} [opts.hint]        what to do next
   * @param {boolean} [opts.canPaste]   the visitor can fix this by pasting text
   * @param {boolean} [opts.retryable]  trying again may work
   * @param {number} [opts.retryAfter]  seconds to wait
   * @param {string} [opts.detail]      technical detail for server logs only (never sent)
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? 400;
    this.hint = opts.hint ?? null;
    this.canPaste = Boolean(opts.canPaste);
    this.retryable = Boolean(opts.retryable);
    this.retryAfter = opts.retryAfter ?? null;
    this.detail = opts.detail ?? null;
  }

  toBody() {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
        can_paste: this.canPaste,
        retryable: this.retryable,
        retry_after: this.retryAfter,
      },
    };
  }
}
