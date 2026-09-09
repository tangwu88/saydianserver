<template>
  <DesktopHeader /><view class="page"
    ><view class="container help-layout"
      ><view class="card nav"
        ><view
          v-for="item in sections"
          :key="item.key"
          :class="active === item.key && 'active'"
          @click="active = item.key"
          >{{ item.label }}</view
        ></view
      ><view class="card content"
        ><template v-if="active === 'service'"
          ><h2>客服与服务</h2>
          <p>
            {{
              service.phone ? "客服电话：" + service.phone : "客服电话未配置"
            }}
          </p><button v-if="service.phone" class="outline-btn" @click="callService">拨打客服</button>
          <p>{{ service.wecomUrl ? "企业客服入口已配置" : "企业客服入口未配置" }}</p><button v-if="service.wecomUrl" class="outline-btn" @click="openService">联系企业客服</button></template
        ><template v-else-if="active === 'afterSale'"
          ><h2>售后政策</h2>
          <rich-text v-if="policies.afterSale" :nodes="policies.afterSale" />
          <p v-else>售后政策尚未在商城后台配置。</p></template
        ><template v-else-if="active === 'privacy'"
          ><h2>隐私政策</h2>
          <rich-text v-if="policies.privacy" :nodes="policies.privacy" />
          <p v-else>隐私政策尚未在商城后台配置。</p></template
        ><template v-else-if="active === 'agreement'"
          ><h2>用户协议</h2>
          <rich-text v-if="policies.service" :nodes="policies.service" />
          <p v-else>用户协议尚未在商城后台配置。</p></template
        ><template v-else
          ><h2>发票信息</h2>
          <p>
            结算时可填写发票抬头。发票规则与开具方式由商城后台政策为准。
          </p></template
        ></view
      ></view
    ></view
  >
</template>
<script setup lang="ts">
import { onLoad } from "@dcloudio/uni-app";
import { reactive, ref } from "vue";
import DesktopHeader from "../../components/DesktopHeader.vue";
import { api, toast } from "../../api";
const active = ref("service"),
  service = reactive<any>({}),
  policies = reactive<any>({});
const sections = [
  { key: "service", label: "联系客服" },
  { key: "afterSale", label: "售后政策" },
  { key: "invoice", label: "发票信息" },
  { key: "privacy", label: "隐私政策" },
  { key: "agreement", label: "用户协议" },
];
onLoad(async (o) => {
  const section = o?.section === 'terms' ? 'agreement' : o?.section;
  active.value = sections.some(x=>x.key===section) ? String(section) : 'service';
  try {
    const r: any = await api("/storefront/bootstrap");
    Object.assign(service, r.configs?.["customer.service"]?.enabled ? r.configs['customer.service'].value : {});
    Object.assign(policies, r.configs?.policies?.enabled ? r.configs.policies.value : {});
  } catch (e) {
    toast(e);
  }
});
function callService(){ if (/^[+\d -]{5,30}$/.test(String(service.phone))) uni.makePhoneCall({phoneNumber:String(service.phone)}); else toast('客服电话格式尚未配置正确'); }
function openService(){try { const url = new URL(String(service.wecomUrl)); if (url.protocol!=='https:' || url.hostname!=='work.weixin.qq.com' || url.username || url.password) throw new Error('企业客服地址未正确配置');
  /* #ifdef H5 */
  location.assign(url.href);
  /* #endif */
  /* #ifndef H5 */
  uni.setClipboardData({data:url.href});
  /* #endif */
}catch(e){toast(e);}}
</script>
<style scoped lang="scss">
.help-layout {
  display: grid;
  gap: 20rpx;
}
.nav {
  display: flex;
  overflow: auto;
  padding: 10rpx;
}
.nav view {
  flex: none;
  padding: 22rpx 28rpx;
  color: var(--muted);
}
.nav .active {
  color: var(--green);
  font-weight: 850;
  background: var(--mint);
  border-radius: 12rpx;
}
.content h2 {
  font-size: 36rpx;
  margin: 0 0 30rpx;
}
.content p {
  color: #53615e;
  line-height: 1.9;
}
.content {
  min-height: 460rpx;
}
@media (min-width: 900px) {
  .help-layout {
    grid-template-columns: 220px 1fr;
  }
  .nav {
    display: block;
    padding: 12px;
  }
  .nav view {
    padding: 16px 18px;
  }
  .content {
    min-height: 600px;
  }
}
</style>
