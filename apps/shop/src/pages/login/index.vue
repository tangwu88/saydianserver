<template><GlobalLogin v-if="isGlobalMall"/><template v-else><DesktopHeader/><view class="page login-page"><view class="login-card card"><image class="login-logo" :src="brandLogo" mode="aspectFit"/><h1>{{ bindTicket ? "绑定手机账号" : "登录赛电商城" }}</h1><text class="muted">与赛电 App 共用会员、订单和积分账户</text>
<view v-if="capabilities?.demo" class="notice">本地演示：使用合成手机号，验证码不会发送到手机。</view>
<view v-if="error" class="error-state">{{ error }}</view>
<view v-if="!bindTicket" class="login-tabs"><button :class="{active:channel==='sms'}" @click="changeChannel('sms')">手机号</button><button :class="{active:channel==='email'}" @click="changeChannel('email')">邮箱</button></view>
<label class="form-label">{{ channel==='sms' || bindTicket ? '手机号' : '邮箱' }}<input v-model="identifier" class="input" :type="channel==='sms' || bindTicket ? 'number' : 'text'" :maxlength="channel==='sms' || bindTicket ? 11 : 254" :placeholder="channel==='sms' || bindTicket ? '请输入手机号' : '请输入邮箱'" @input="resetCode" /></label>
<view><label class="form-label">验证码</label><view class="code-row"><input v-model="code" class="input" type="number" maxlength="6" :placeholder="channel==='sms' || bindTicket ? '短信验证码' : '邮箱验证码'"/><button class="outline-btn" :disabled="!!countdown || busy" @click="sendCode">{{ countdown ? countdown+'秒后重试' : '获取验证码' }}</button></view><text v-if="capabilities && !enabled" class="muted">{{ capabilityReason }}</text><text v-if="devCode" class="notice">仅本地测试验证码：{{ devCode }}</text></view>
<view class="agreement"><checkbox-group @change="agreementAccepted=!!$event.detail.value.length"><label><checkbox value="yes" :checked="agreementAccepted"/>{{ capabilities?.demo ? '我确认仅进行本地模拟测试' : '我已阅读并同意' }}</label></checkbox-group><text class="link" @click="help('agreement')">用户协议</text><text>与</text><text class="link" @click="help('privacy')">隐私政策</text></view>
<button class="primary-btn" :loading="busy" :disabled="busy" @click="login">{{ bindTicket ? "验证并绑定" : "登录" }}</button>
<!-- #ifdef H5 -->
<button v-if="isWechat && !bindTicket" class="outline-btn wechat-login" :disabled="busy || !capabilities?.login?.wechatH5?.enabled" @click="officialLogin">微信授权登录</button>
<text v-if="isWechat && capabilities && !capabilities.login.wechatH5.enabled" class="muted">{{ capabilities.login.wechatH5.reason }}</text>
<!-- #endif -->
<!-- #ifdef MP-WEIXIN --><button class="outline-btn" @click="miniLogin">微信小程序登录</button><!-- #endif -->
<button class="text-button" @click="browse">先逛逛</button>
</view></view></template></template>
<script setup lang="ts">
import { mallStorage, isGlobalMall } from "../../realm";
import GlobalLogin from "../../components/GlobalLogin.vue";
import { onLoad,onUnload } from "@dcloudio/uni-app"; import { computed,ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";import { brandLogo } from "../../storefront";
import { api,saveMallSession,COMMERCE_CONSENT_VERSION,ensureMiniProgramSession,toast } from "../../api";
import { bindReferral,captureReferral } from "../../session";import { safeMallRoute } from "../../commerce-model";
const identifier=ref(""),code=ref(""),channel=ref<"sms"|"email">("sms"),challengeId=ref(""),agreementAccepted=ref(false),busy=ref(false),countdown=ref(0),devCode=ref(""),error=ref(""),bindTicket=ref(""),capabilities=ref<any>();
const isWechat=typeof navigator!=="undefined" && /micromessenger/i.test(navigator.userAgent);
const enabled=computed(()=>bindTicket.value ? capabilities.value?.login?.sms?.enabled : capabilities.value?.login?.[channel.value]?.enabled);
const capabilityReason=computed(()=>bindTicket.value ? capabilities.value?.login?.sms?.reason : capabilities.value?.login?.[channel.value]?.reason);
let timer:ReturnType<typeof setInterval>|undefined;
onUnload(()=>{if(timer)clearInterval(timer);});
onLoad(async()=>{
  if (isGlobalMall) return;
  /* #ifdef H5 */
  if(typeof navigator!=="undefined" && /wxwork/i.test(navigator.userAgent)){uni.reLaunch({url:"/pages/employee/index"});return;}
  /* #endif */
  captureReferral();
  try { capabilities.value=await api("/storefront/capabilities");
    /* #ifdef H5 */
    const query=new URLSearchParams(location.search),state=query.get("state"),oauthCode=query.get("code");
    if(state && oauthCode){
      const context=sessionStorage.getItem("saidian-oauth:"+state);if(!context)throw new Error("授权校验已失效，请重新点击微信登录");
      const stored=JSON.parse(context);busy.value=true;
      const response:any=await api("/auth/wechat/h5/login",{method:"POST",data:{code:oauthCode,state,codeVerifier:stored.verifier,consentVersion:COMMERCE_CONSENT_VERSION}});
      sessionStorage.removeItem("saidian-oauth:"+state);
      const clean=new URL(location.href);clean.searchParams.delete("code");clean.searchParams.delete("state");history.replaceState(null,"",clean.href);
      if(response.requiresMobileBinding){bindTicket.value=response.bindTicket;agreementAccepted.value=true;channel.value="sms";resetCode();mallStorage.set("saidian-post-login-route",safeMallRoute(response.returnTo));}
      else await save(response);
    }
    /* #endif */
  } catch(e){error.value=e instanceof Error?e.message:"登录暂不可用";} finally {busy.value=false;}
});
async function sendCode(){
  if(countdown.value || busy.value)return;
  if(!enabled.value)return toast(capabilityReason.value||"当前方式暂时无法获取验证码，请稍后再试");
  const value=loginIdentifier();if(!value)return;
  busy.value=true;
  try{const response:any=bindTicket.value
      ? await api("/auth/sms/request",{method:"POST",data:{mobile:value,usage:"bind_mobile"}})
      : await api("/auth/code/request",{method:"POST",data:{channel:channel.value,identifier:value}});
    challengeId.value=String(response.challengeId||"");devCode.value=String(response.devCode||"");if(response.devCode)code.value=String(response.devCode);countdown.value=Math.max(1,Number(response.retryAfter||60));timer=setInterval(()=>{countdown.value--;if(!countdown.value && timer)clearInterval(timer);},1000);
  }catch(e){toast(e);}
  finally{busy.value=false;}
}
async function login(){
  if(busy.value)return;if(!enabled.value)return toast(capabilityReason.value||"当前方式暂时无法登录，请稍后再试");if(!agreementAccepted.value)return toast("请先阅读并同意协议");
  const value=loginIdentifier();if(!value)return;if(!/^\d{6}$/.test(code.value))return toast("请输入6位验证码");
  if(channel.value==="email" && !bindTicket.value && !challengeId.value)return toast("请先获取当前邮箱的验证码");
  busy.value=true;error.value="";
  try{
    const path=bindTicket.value?"/auth/wechat/h5/bind-mobile":"/auth/code/login";
    const response=await api(path,{method:"POST",data:{...(bindTicket.value?{mobile:value,bindTicket:bindTicket.value}:{channel:channel.value,identifier:value,...(challengeId.value?{challengeId:challengeId.value}:{})}),code:code.value,consentVersion:COMMERCE_CONSENT_VERSION,referralCode:String(mallStorage.get("saidian-ref")||"")}});
    await save(response);
  }catch(e){error.value=e instanceof Error?e.message:"登录失败";}finally{busy.value=false;}
}
async function save(response:any){await saveMallSession(response);await bindReferral();const route=safeMallRoute(response.returnTo||mallStorage.get("saidian-post-login-route"));mallStorage.remove("saidian-post-login-route");uni.reLaunch({url:route});}
function resetCode(){challengeId.value="";code.value="";devCode.value="";}
function changeChannel(next:"sms"|"email"){if(busy.value||channel.value===next)return;channel.value=next;identifier.value="";resetCode();error.value="";}
function loginIdentifier(){const value=identifier.value.trim();if(channel.value==="sms"||bindTicket.value){if(!/^1\d{10}$/.test(value)){toast("请输入11位手机号");return "";}}else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)||value.length>254){toast("请输入正确的邮箱地址");return "";}return value;}
async function officialLogin(){
  if(!agreementAccepted.value)return toast("请先阅读并同意协议");
  /* #ifdef H5 */
  busy.value=true;
  try{const bytes=crypto.getRandomValues(new Uint8Array(32));const verifier=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));const challenge=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
    const response:any=await api("/auth/wechat/h5/authorize-url",{method:"POST",data:{returnTo:safeMallRoute(mallStorage.get("saidian-post-login-route")),codeChallenge:challenge,referralCode:String(mallStorage.get("saidian-ref")||"")}});
    const destination=new URL(response.authorizeUrl);if(destination.protocol!=="https:" || destination.hostname!=="open.weixin.qq.com")throw new Error("授权地址不正确");
    sessionStorage.setItem("saidian-oauth:"+response.state,JSON.stringify({verifier}));location.assign(destination.href);
  }catch(e){toast(e);}finally{busy.value=false;}
  /* #endif */
}
async function miniLogin(){if(!agreementAccepted.value)return toast("请先阅读并同意协议");try{await ensureMiniProgramSession(true);await bindReferral();uni.reLaunch({url:safeMallRoute(mallStorage.get("saidian-post-login-route"))});}catch(e){toast(e);}}
function help(section:string){uni.navigateTo({url:"/pages/help/index?section="+section});}
function browse(){uni.switchTab({url:"/pages/home/index"});}
</script>
<style scoped>.login-page{display:flex;justify-content:center;padding-top:32px;}.login-card{max-width:480px;width:100%;height:max-content;padding:28px;}.login-logo{width:116px;height:46px;display:block;margin-bottom:24px;}h1{font-size:24px;margin:0 0 12px;}.login-tabs{display:flex;margin:24px 0;gap:12px;}.login-tabs button{flex:1;font-size:16px;background:#f1f2f4}.login-tabs .active{color:var(--green);background:var(--mint);}.form-label{display:block;margin:18px 0 8px;font-size:14px;}.input{margin-top:8px;height:46px;font-size:16px;}.code-row{display:grid;grid-template-columns:1fr 130px;gap:10px;}.code-row .input{margin:0;}.code-row button{height:46px;font-size:14px;}.agreement{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:14px;line-height:1.8;margin:22px 0;}.link{color:var(--green);}.wechat-login{margin-top:14px;}.muted{font-size:14px;line-height:1.6;}.notice{display:block;background:#fff8e6;padding:10px;font-size:14px;margin-top:14px;}.text-button{margin:18px auto 0;}</style>
