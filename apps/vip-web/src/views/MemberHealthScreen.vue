<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import HealthScreenEntry from "@saydian/health-screen-ui/entry";
import type { HealthScreenTransport } from "@saydian/app-contracts";
import { api, data, errorMessage, partnerTokenKey } from "../api";
const route = useRoute(),
  memberId = computed(() => String(route.params.id || "me"));
const path = (id: string) =>
  `/members/${encodeURIComponent(id)}/health-analysis`;
const sessionKey = () => sessionStorage.getItem(partnerTokenKey);
const transport: HealthScreenTransport = {
  profile: async (id, signal) =>
    data(await api.get(path(id) + "/profile", { signal })),
  completeProfile: async () => {
    throw new Error("请由会员本人或总管理员完善资料");
  },
  updates: async (id, days, signal) =>
    data(await api.get(`${path(id)}/updates`, { params: { days }, signal })),
  references: async (id, cursor, signal) =>
    data(
      await api.get(`${path(id)}/references`, { params: { cursor }, signal }),
    ),
  saveReference: async (id, input) =>
    data(await api.post(`${path(id)}/references`, input)),
  voidReference: async (id, referenceId, reason) =>
    data(
      await api.post(
        `${path(id)}/references/${encodeURIComponent(referenceId)}/void`,
        { reason },
      ),
    ),
  load: async (id, days, signal) =>
    data(await api.get(path(id), { params: { days }, signal, timeout: 50000 })),
  records: async (id, days, metric, cursor, signal) =>
    data(
      await api.get(`${path(id)}/records`, {
        params: { days, metric, cursor },
        signal,
      }),
    ),
  generate: async (id, days, inputDigest, requestKey) =>
    data(
      await api.post(
        `${path(id)}/analyses`,
        { days, inputDigest, requestKey },
        { timeout: 65000 },
      ),
    ),
  result: async (id, analysisId, signal) =>
    data(
      await api.get(`${path(id)}/analyses/${encodeURIComponent(analysisId)}`, {
        signal,
      }),
    ),
};
</script>
<template>
  <HealthScreenEntry
    @self="$router.replace('/health-screen')"
    :key="memberId"
    :member-id="memberId"
    :transport="transport"
    back-url="/vip/members"
    :error-message="errorMessage"
    :session-key="sessionKey"
  />
</template>
