import type { HealthScreenUpdates } from "@saydian/app-contracts";
export function changedHealthGroups(
  previous: HealthScreenUpdates | null,
  next: HealthScreenUpdates,
) {
  if (!previous) return [];
  return next.groups
    .filter((n) => {
      const p = previous.groups.find((p) => p.group === n.group);
      return !p || p.count !== n.count || p.updatedAt !== n.updatedAt;
    })
    .map((n) => {
      const old = previous.groups.find((p) => p.group === n.group);
      const added = n.count - (old?.count || 0);
      return {
        group: n.group,
        message: added > 0 ? `收到 ${added} 条新记录` : "数据已更新",
        updatedAt: n.updatedAt,
      };
    });
}
