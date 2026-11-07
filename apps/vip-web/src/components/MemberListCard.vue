<script setup lang="ts">
import { Phone, Message } from "@element-plus/icons-vue";
import { date } from "../present";
import {
  memberName,
  memberInitial,
  memberGender,
  memberAge,
  memberMeasurement,
  memberCount,
  type MemberSummary,
} from "../member-summary";
defineProps<{
  member: MemberSummary;
  canViewHealth: boolean;
  showHealthScreen: boolean;
}>();
defineEmits<{ open: []; healthScreen: [] }>();
</script>
<template>
  <article
    class="member-card"
    :aria-label="`${memberName(member.nickname)}的会员资料`"
  >
    <header class="member-card-header">
      <div class="member-identity">
        <el-avatar
          :size="52"
          :src="member.avatarUrl || ''"
          :alt="`${memberName(member.nickname)}的头像`"
          class="member-avatar"
          >{{ memberInitial(member.nickname) }}</el-avatar
        >
        <div class="member-title">
          <h2>{{ memberName(member.nickname) }}</h2>
          <span>会员编号 {{ member.memberNo ?? "未获取" }}</span>
        </div>
      </div>
      <div class="member-actions">
        <el-button type="primary" plain @click="$emit('open')">{{
          canViewHealth ? "查看档案" : "查看资料"
        }}</el-button>
        <el-button
          v-if="canViewHealth && showHealthScreen"
          @click="$emit('healthScreen')"
          >健康大屏</el-button
        >
      </div>
    </header>
    <dl class="member-contacts">
      <div>
        <dt>
          <el-icon aria-hidden="true"><Phone /></el-icon>手机号
        </dt>
        <dd :class="{ missing: !member.mobile }">
          {{ member.mobile || "未填写" }}
        </dd>
      </div>
      <div>
        <dt>
          <el-icon aria-hidden="true"><Message /></el-icon>邮箱
        </dt>
        <dd :class="{ missing: !member.email }">
          {{ member.email || "未填写" }}
        </dd>
      </div>
    </dl>
    <dl class="member-basics">
      <div>
        <dt>性别</dt>
        <dd>{{ memberGender(member.gender) }}</dd>
      </div>
      <template v-if="canViewHealth">
        <div>
          <dt>年龄</dt>
          <dd>{{ memberAge(member.birthday) }}</dd>
        </div>
        <div>
          <dt>身高</dt>
          <dd>{{ memberMeasurement(member.heightCm, "cm") }}</dd>
        </div>
        <div>
          <dt>体重</dt>
          <dd>{{ memberMeasurement(member.weightKg, "kg") }}</dd>
        </div>
      </template>
    </dl>
    <footer class="member-card-footer">
      <div class="member-stats">
        <span
          >设备 <b>{{ memberCount(member._count?.devices) }}</b> 台</span
        ><span v-if="canViewHealth"
          >健康记录
          <b>{{ memberCount(member._count?.healthRecords) }}</b> 条</span
        >
      </div>
      <span class="member-created">注册于 {{ date(member.createdAt) }}</span>
    </footer>
  </article>
</template>
<style scoped>
.member-card {
  min-width: 0;
  border: 1px solid #e1e6ee;
  border-radius: 14px;
  padding: 20px;
  background: #fff;
}
.member-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.member-identity {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}
.member-avatar {
  flex: none;
  background: #fbecef;
  color: #ba1934;
  font-size: 22px;
  font-weight: 700;
}
.member-title {
  min-width: 0;
}
.member-title h2 {
  font-size: 17px;
  line-height: 1.45;
  margin: 0 0 5px;
  overflow-wrap: anywhere;
}
.member-title > span {
  font-size: 12px;
  color: #68758b;
}
.member-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  flex: none;
}
.member-actions .el-button {
  margin: 0;
  min-height: 38px;
}
.member-contacts,
.member-basics {
  display: grid;
  gap: 16px;
  margin: 0;
}
.member-contacts {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 18px;
}
.member-contacts > div,
.member-basics > div {
  min-width: 0;
}
.member-card dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #68758b;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 7px;
}
.member-card dd {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: #172134;
}
.member-card dd.missing {
  color: #98a2b3;
}
.member-basics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  background: #f7f8fb;
  border-radius: 10px;
  padding: 14px 16px;
}
.member-basics dt {
  margin-bottom: 4px;
}
.member-basics dd {
  font-weight: 600;
  font-size: 14px;
}
.member-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding-top: 16px;
  margin-top: 18px;
  border-top: 1px solid #edf0f5;
  font-size: 12px;
  color: #68758b;
  line-height: 1.6;
}
.member-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.member-stats b {
  font-weight: 600;
  color: #34425a;
}
.member-created {
  overflow-wrap: anywhere;
}
@media (max-width: 600px), (max-width: 950px) and (max-height: 500px) {
  .member-card {
    padding: 16px;
  }
  .member-card-header {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 18px;
  }
  .member-identity {
    width: 100%;
  }
  .member-actions {
    width: 100%;
    justify-content: flex-start;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }
  .member-actions .el-button {
    width: 100%;
    min-height: 44px;
  }
  .member-contacts {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .member-contacts > div {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: start;
    gap: 10px;
  }
  .member-contacts dt {
    margin: 2px 0 0;
  }
  .member-basics {
    padding: 12px;
    gap: 10px;
  }
  .member-basics dd {
    font-size: 13px;
  }
  .member-card-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .member-title h2 {
    font-size: 16px;
  }
}
@media (max-width: 360px) {
  .member-basics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .member-identity {
    gap: 10px;
  }
}
</style>
