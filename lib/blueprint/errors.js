"use strict";

class BlueprintError extends Error {
  constructor(status, code, message, details) {
    super(String(message || code || "Blueprint error"));
    this.name = "BlueprintError";
    this.status = Number(status || 500);
    this.code = String(code || "internal_error");
    if (details !== undefined) this.details = details;
  }
}

const toErrorPayload = (err) => {
  if (err instanceof BlueprintError) {
    return {
      status: err.status,
      body: {
        ok: false,
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: "internal_error",
      message: String(err?.message || "Unexpected error"),
    },
  };
};

module.exports = {
  BlueprintError,
  toErrorPayload,
};
