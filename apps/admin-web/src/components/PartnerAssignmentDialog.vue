<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api, readableError, responseData } from "../api";
const props = defineProps<{ member: Record<string, any> | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const partnerId = ref<string | null>(null),
  partners = ref<any[]>([]),
  reason = ref(""),
  saving = ref(false);
async function search(value = "") {
  try {
    partners.value = responseData<any>(
      await api.get("/partners", { params: { search: value } }),
    ).items;
  } catch (cause) {
    ElMessage.error(readableError(cause));
  }
}
watch(
  () => props.member,
  (member) => {
    partnerId.value = member?.partnerId ?? null;
    reason.value = "";
    if (member) void search();
  },
);
async function save() {
  if (!props.member || saving.value) return;
  if (!reason.value.trim()) {
    ElMessage.warning("请填写归属调整原因");
    return;
  }
  saving.value = true;
  try {
    await api.post(`/partners/members/${props.member.id}/assignment`, {
      partnerId: partnerId.value,
      expectedPartnerId: props.member.partnerId ?? null,
      reason: reason.value.trim(),
    });
    ElMessage.success("品牌伙伴归属已更新");
    emit("saved");
    emit("close");
  } catch (cause) {
    ElMessage.error(readableError(cause));
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <el-dialog
    :model-value="!!member"
    title="调整品牌伙伴归属"
    width="560px"
    :close-on-click-modal="false"
    @close="emit('close')"
    ><p>{{ member?.memberNo }} · {{ member?.nickname }}</p>
    <el-alert
      title="调整后，会员完整历史资料由新品牌伙伴查看，原伙伴将失去访问权限。"
      type="info"
      :closable="false"
    /><el-form label-position="top" style="margin-top: 20px" :disabled="saving"
      ><el-form-item label="所属品牌伙伴"
        ><el-select
          v-model="partnerId"
          clearable
          filterable
          remote
          :remote-method="search"
          placeholder="无品牌伙伴"
          style="width: 100%"
          @clear="partnerId = null"
          ><el-option
            v-for="partner in partners"
            :key="partner.id"
            :value="partner.id"
            :label="`${partner.name} · ${partner.partnerNo}`"
            :disabled="!partner.active" /></el-select></el-form-item
      ><el-form-item label="调整原因"
        ><el-input
          v-model="reason"
          type="textarea"
          maxlength="300" /></el-form-item></el-form
    ><template #footer
      ><el-button :disabled="saving" @click="emit('close')">取消</el-button
      ><el-button type="primary" :loading="saving" @click="save"
        >保存归属</el-button
      ></template
    ></el-dialog
  >
</template>
