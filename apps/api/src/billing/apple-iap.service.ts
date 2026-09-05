import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { envBoolean } from "../common/environment";

export type VerifiedAppleTransaction = {
  environment: Environment;
  transaction: JWSTransactionDecodedPayload;
};

export type VerifiedAppleNotification = {
  environment: Environment;
  notification: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
};

export type AppleTransactionExpectation = {
  accountToken: string;
  productId: string;
  amountCents: number;
  currency: string;
  allowRevoked?: boolean;
};

@Injectable()
export class AppleIapService {
  private verifiers: Array<{
    environment: Environment;
    verifier: SignedDataVerifier;
  }> | null = null;

  async verifyTransaction(signedTransactionInfo: string): Promise<VerifiedAppleTransaction> {
    let lastError: unknown;
    for (const candidate of this.configuredVerifiers()) {
      try {
        return {
          environment: candidate.environment,
          transaction: await candidate.verifier.verifyAndDecodeTransaction(
            signedTransactionInfo,
          ),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new AppleSignatureVerificationError(lastError);
  }

  async verifyNotification(signedPayload: string): Promise<VerifiedAppleNotification> {
    let lastError: unknown;
    for (const candidate of this.configuredVerifiers()) {
      try {
        const notification = await candidate.verifier.verifyAndDecodeNotification(
          signedPayload,
        );
        const signedTransactionInfo = notification.data?.signedTransactionInfo;
        return {
          environment: candidate.environment,
          notification,
          transaction: signedTransactionInfo
            ? await candidate.verifier.verifyAndDecodeTransaction(signedTransactionInfo)
            : null,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new AppleSignatureVerificationError(lastError);
  }

  private configuredVerifiers() {
    if (this.verifiers) return this.verifiers;
    const bundleId = String(process.env.APPLE_IAP_BUNDLE_ID ?? "").trim();
    const certificatePaths = String(process.env.APPLE_ROOT_CA_PATHS ?? "")
      .split(/[,;\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!bundleId || !certificatePaths.length) {
      throw new ServiceUnavailableException("苹果购买验证尚未配置，请稍后再试");
    }
    let roots: Buffer[];
    try {
      roots = certificatePaths.map((file) => readFileSync(file));
    } catch {
      throw new ServiceUnavailableException("苹果购买验证尚未配置，请稍后再试");
    }
    const configured = String(
      process.env.APPLE_IAP_ENVIRONMENTS ??
        (process.env.NODE_ENV === "production" ? "Production" : "Sandbox"),
    )
      .split(/[,;\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const environments = [...new Set(configured)].map((value) => {
      if (value === "production") return Environment.PRODUCTION;
      if (value === "sandbox") return Environment.SANDBOX;
      throw new ServiceUnavailableException("苹果购买验证环境配置不正确");
    });
    const appAppleId = Number(process.env.APPLE_IAP_APP_APPLE_ID ?? 0);
    if (
      environments.includes(Environment.PRODUCTION) &&
      (!Number.isSafeInteger(appAppleId) || appAppleId <= 0)
    ) {
      throw new ServiceUnavailableException("苹果购买验证尚未配置，请稍后再试");
    }
    const onlineChecks = envBoolean("APPLE_IAP_ONLINE_CHECKS", true);
    this.verifiers = environments.map((environment) => ({
      environment,
      verifier: new SignedDataVerifier(
        roots,
        onlineChecks,
        environment,
        bundleId,
        environment === Environment.PRODUCTION ? appAppleId : undefined,
      ),
    }));
    if (!this.verifiers.length) {
      throw new ServiceUnavailableException("苹果购买验证尚未配置，请稍后再试");
    }
    return this.verifiers;
  }
}

export class AppleSignatureVerificationError extends Error {
  constructor(cause: unknown) {
    super("Apple signed data verification failed", { cause });
    this.name = "AppleSignatureVerificationError";
  }
}

export function appleTransactionValidationError(
  transaction: JWSTransactionDecodedPayload,
  expected: AppleTransactionExpectation,
): string | null {
  if (!transaction.transactionId) return "missing_transaction_id";
  if (!transaction.productId || transaction.productId !== expected.productId) {
    return "product_mismatch";
  }
  if (
    !transaction.appAccountToken ||
    transaction.appAccountToken.toLowerCase() !== expected.accountToken.toLowerCase()
  ) {
    return "account_mismatch";
  }
  if (!expected.allowRevoked && transaction.revocationDate !== undefined) {
    return "transaction_revoked";
  }
  if (transaction.quantity !== undefined && transaction.quantity !== 1) {
    return "quantity_mismatch";
  }
  if (
    transaction.currency &&
    transaction.currency.toUpperCase() !== expected.currency.toUpperCase()
  ) {
    return "currency_mismatch";
  }
  // Apple reports price in currency milliunits. One CNY cent is 10 milliunits.
  if (
    transaction.price !== undefined &&
    transaction.price !== expected.amountCents * 10
  ) {
    return "price_mismatch";
  }
  return null;
}
