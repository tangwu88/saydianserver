import { describe, expect, it, vi } from "vitest";
import { BillingController } from "./billing.controller";

describe("App payment callback isolation", () => {
  it("routes App callbacks to App integrations while legacy callbacks stay unchanged", async () => {
    const billing = {
      handleWechatNotification: vi.fn().mockResolvedValue({ code: "SUCCESS" }),
      handleWechatRefundNotification: vi.fn().mockResolvedValue({ code: "SUCCESS" }),
      handleAlipayNotification: vi.fn().mockResolvedValue("success"),
    };
    const controller = new BillingController(billing as any);
    const rawBody = Buffer.from("{\"id\":\"event\"}");
    const request = { rawBody } as any;
    const response = {
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    await controller.wechatNotify({}, { id: "legacy" }, request);
    await controller.wechatAppNotify({}, { id: "app" }, request);
    await controller.wechatRefundNotify({}, { id: "legacy-refund" }, request);
    await controller.wechatAppRefundNotify({}, { id: "app-refund" }, request);
    await controller.alipayNotify({ out_trade_no: "legacy" }, response);
    await controller.alipayAppNotify({ out_trade_no: "app" }, response);

    expect(billing.handleWechatNotification).toHaveBeenNthCalledWith(
      1,
      {},
      { id: "legacy" },
      rawBody,
    );
    expect(billing.handleWechatNotification).toHaveBeenNthCalledWith(
      2,
      {},
      { id: "app" },
      rawBody,
      "wechat_pay_app",
    );
    expect(billing.handleWechatRefundNotification).toHaveBeenNthCalledWith(
      1,
      {},
      { id: "legacy-refund" },
      rawBody,
    );
    expect(billing.handleWechatRefundNotification).toHaveBeenNthCalledWith(
      2,
      {},
      { id: "app-refund" },
      rawBody,
      "wechat_pay_app",
    );
    expect(billing.handleAlipayNotification).toHaveBeenNthCalledWith(1, {
      out_trade_no: "legacy",
    });
    expect(billing.handleAlipayNotification).toHaveBeenNthCalledWith(
      2,
      { out_trade_no: "app" },
      "alipay_app",
    );
    expect(response.send).toHaveBeenCalledTimes(2);
  });
});
