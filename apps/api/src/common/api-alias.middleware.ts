import type { NextFunction, Request, Response } from "express";

/** Transport aliases only: never select a database, signing key or authorization policy. */
export function apiAlias(request: Request, _response: Response, next: NextFunction): void {
  if (/^\/global\/(?:api(?:[/?]|$)|health(?:[/?]|$))/.test(request.url)) {
    const url = new URL(request.url, "http://internal.invalid");
    url.pathname = url.pathname.slice("/global".length);
    if (url.pathname === "/health") url.pathname = "/health/ready";
    // Preserve the original App's package identity, not an account realm.
    if (url.pathname === "/api/saydian-app/v2/support/app-update" && !url.searchParams.has("product")) {
      url.searchParams.set("product", "saydian-global");
    }
    request.url = url.pathname + url.search;
    // Existing authorization and maintenance gates classify originalUrl.
    request.originalUrl = request.url;
  }
  next();
}
