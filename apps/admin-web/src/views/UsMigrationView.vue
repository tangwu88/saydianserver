<script setup lang="ts">
import { ref } from "vue";
import { api, responseData, readableError } from "../api";
const result=ref<{counts?:{users:string;candidates:string;database_bytes:string};warning?:string;accounts:Array<Record<string,unknown>>}>({accounts:[]});
const page=ref(1), busy=ref(false), error=ref("");
async function load() {
  busy.value=true; error.value="";
  try { result.value=responseData(await api.get('/us-migration/inventory',{params:{page:page.value}})); }
  catch(e) { error.value=readableError(e); }
  finally { busy.value=false; }
}
</script>
<template>
  <section>
    <h1>美国迁移候选账号</h1>
    <p>只读核对清单。协议来源只用于筛选候选；共用账号、权益及附件需逐项核对。此页面不批准或执行迁移。</p>
    <el-button :loading="busy" @click="load">读取候选清单</el-button>
    <el-input-number v-model="page" :min="1" :max="10000" />
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <p v-if="result.counts">源库账号 {{result.counts.users}}；候选 {{result.counts.candidates}}；源库总字节 {{result.counts.database_bytes}}（不代表迁移大小）。</p>
    <el-table :data="result.accounts" stripe>
      <el-table-column prop="id" label="账号 UUID" min-width="285" />
      <el-table-column prop="identifier" label="脱敏账号" min-width="180" />
      <el-table-column prop="classification" label="归属核对" min-width="220" />
      <el-table-column prop="sources" label="协议来源" min-width="200" />
      <el-table-column v-for="field in ['devices','health','files','file_bytes','memberships','credit_entries','orders','care_relationships']" :key="field" :prop="field" :label="field" min-width="110" />
    </el-table>
  </section>
</template>
