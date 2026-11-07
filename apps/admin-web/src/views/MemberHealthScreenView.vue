<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import HealthScreenEntry from "@saydian/health-screen-ui/entry";
import type { HealthScreenTransport } from "@saydian/app-contracts";
import {
  api,
  responseData,
  readableError,
  adminSessionKey,
  getAdminRoles,
} from "../api";
const route = useRoute(),
  memberId = computed(() => String(route.params.id || "me"));
const path = (id: string) =>
  `/member-health-analysis/${encodeURIComponent(id)}`;
const transport: HealthScreenTransport = {
  profile: async (id, signal) =>
    responseData(await api.get(path(id) + "/profile", { signal })),
  completeProfile: async (id, v) =>
    responseData(await api.post(path(id) + "/profile", v)),
  updates: async (id, days, signal) =>
    responseData(
      await api.get(`${path(id)}/updates`, { params: { days }, signal }),
    ),
  references: async (id, cursor, signal) =>
    responseData(
      await api.get(`${path(id)}/references`, { params: { cursor }, signal }),
    ),
  saveReference: async (id, input) =>
    responseData(await api.post(`${path(id)}/references`, input)),
  voidReference: async (id, referenceId, reason) =>
    responseData(
      await api.post(
        `${path(id)}/references/${encodeURIComponent(referenceId)}/void`,
        { reason },
      ),
    ),
  load: async (id, days, signal) =>
    responseData(
      await api.get(path(id), { params: { days }, signal, timeout: 50000 }),
    ),
  records: async (id, days, metric, cursor, signal, reason) =>
    responseData(
      await api.get(`${path(id)}/records`, {
        params: { days, metric, cursor, reason },
        signal,
      }),
    ),
  generate: async (id, days, inputDigest, requestKey) =>
    responseData(
      await api.post(
        `${path(id)}/analyses`,
        { days, inputDigest, requestKey },
        { timeout: 65000 },
      ),
    ),
  result: async (id, analysisId, signal) =>
    responseData(
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
    :back-url="`${$router.options.history.base}/members`"
    :error-message="readableError"
    :session-key="adminSessionKey"
    :requires-record-reason="!getAdminRoles().includes('SUPER_ADMIN')"
  />
</template>
