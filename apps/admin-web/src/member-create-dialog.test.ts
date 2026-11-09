import { readFileSync } from "node:fs";
import ts from "typescript";
import { ref } from "vue";
import { expect, it, vi } from "vitest";
function harness() {
  const sfc = readFileSync(new URL("./components/MemberCreateDialog.vue", import.meta.url), "utf8");
  const source = ts.createSourceFile("dialog.ts", sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer=ts.createPrinter();
  const code=ts.transpileModule(source.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>printer.printNode(ts.EmitHint.Unspecified,s,source)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const emit=vi.fn(),post=vi.fn(async(..._args:any[])=>({data:{data:{memberNo:"10001"}}}));
  const messages={success:vi.fn()},watch=vi.fn(),unmount=vi.fn(),session={value:"session-a"};
  const deps={ref,watch,onBeforeUnmount:unmount,defineProps:()=>({modelValue:true}),defineEmits:()=>emit,ElMessage:messages,api:{post},adminSessionKey:()=>session.value,readableError:(e:any)=>e.message,responseData:(r:any)=>r.data.data};
  const instance=new Function(...Object.keys(deps),code+"\nreturn {mobile,password,error,busy,submit,clear};")(...Object.values(deps));
  return {...instance,emit,post,messages,watch,unmount,session,sfc};
}
it("requires a phone and valid password before making a request",async()=>{
  const h=harness();await h.submit();expect(h.error.value).toBe("请填写手机号");
  h.mobile.value="13900001234";h.password.value="short";await h.submit();expect(h.error.value).toContain("至少8位");
  h.password.value="密".repeat(25);await h.submit();expect(h.post).not.toHaveBeenCalled();
});
it("submits only the phone and password once, clears secrets, and refreshes on success",async()=>{
  const h=harness();h.mobile.value=" 13900001234 ";h.password.value="synthetic-password";
  let finish!:(r:any)=>void;h.post.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const pending=h.submit();await h.submit();expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0]?.slice(0,2)).toEqual(["/members",{mobile:"13900001234",password:"synthetic-password"}]);
  finish({data:{data:{memberNo:"10001"}}});await pending;
  expect(h.password.value).toBe("");expect(h.emit).toHaveBeenCalledWith("created");expect(h.emit).toHaveBeenCalledWith("update:modelValue",false);
});
it("retains the dialog and shows duplicate-phone errors without a second create",async()=>{
  const h=harness();h.mobile.value="13900001234";h.password.value="synthetic-password";h.post.mockRejectedValueOnce(new Error("该手机号已注册"));
  await h.submit();expect(h.error.value).toBe("该手机号已注册");expect(h.emit).not.toHaveBeenCalled();expect(h.busy.value).toBe(false);
});
it("does not apply a stale result to another admin session",async()=>{
  const h=harness();h.mobile.value="13900001234";h.password.value="synthetic-password";
  let finish!:(r:any)=>void;h.post.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const pending=h.submit();h.session.value="session-b";finish({data:{data:{memberNo:"10001"}}});await pending;
  expect(h.emit).not.toHaveBeenCalled();expect(h.messages.success).not.toHaveBeenCalled();
  h.unmount.mock.calls[0]![0]();expect(h.password.value).toBe("");
});
it("clears form data when closed and restricts the list entry to super administrators",()=>{
  const h=harness();h.password.value="synthetic-password";h.watch.mock.calls[0]![1]();expect(h.password.value).toBe("");
  const view=readFileSync(new URL("./views/ResourceView.vue",import.meta.url),"utf8");
  expect(view).toContain('v-if="resource === \'members\' && canManageMemberVerification"');
  expect(view).toContain('@created="memberCreated"');
});
