import { safeObject } from "../common/crypto";

export const shareTitles = {
  sleep: ['睡眠报告','Sleep report'], health: ['健康记录','Health record'],
  workout: ['运动记录','Workout'], week: ['我的这一周','My week']
} as const;

export const shareFieldNames = {
  sleepMinutes: ['睡眠时长','Sleep duration','min'], deepMinutes: ['深睡','Deep sleep','min'],
  sleepAverageMinutes: ['平均睡眠','Average sleep','min'],
  previousSleepAverageMinutes: ['上周同期平均睡眠','Previous week’s average sleep','min'],
  previousSportMinutes: ['上周同期运动时长','Previous week’s activity','min'],
  rangeEnd: ['记录截至','Through',''],
  lightMinutes: ['浅睡','Light sleep','min'], remMinutes: ['快速眼动','REM sleep','min'],
  awakeMinutes: ['清醒时长','Awake time','min'], sleepStart: ['入睡','Fell asleep',''],
  sleepEnd: ['醒来','Woke up',''], sleepScore: ['睡眠评分','Sleep score',''],
  sportName: ['运动','Activity',''], sportMinutes: ['运动时长','Duration','min'],
  distanceKm: ['距离','Distance','km'], steps: ['步数','Steps',''],
  heartRate: ['心率','Heart rate','bpm'], hrv: ['心率变异性','HRV','ms'],
  oxygen: ['血氧','Blood oxygen','%'], temperatureC: ['温度','Temperature','°C'],
  systolic: ['收缩压','Systolic pressure','mmHg'], diastolic: ['舒张压','Diastolic pressure','mmHg'],
  pulse: ['脉搏','Pulse','bpm'], measuredTime: ['测量时间','Reading time',''],
  recordDays: ['有记录天数','Days recorded',''], stress: ['压力','Stress',''],
  bloodGlucose: ['血糖','Blood glucose','mmol/L']
} as const;

export const shareFieldPriority = {
  sleep: ['sleepMinutes','sleepAverageMinutes','sleepScore'],
  health: ['systolic','diastolic','heartRate','oxygen','hrv','temperatureC','steps','distanceKm','bloodGlucose','stress','pulse'],
  workout: ['sportMinutes','distanceKm','steps','heartRate','sportName'],
  week: ['sleepAverageMinutes','sleepMinutes','sportMinutes','steps','distanceKm']
} as const;

export function shareProjectNames(source: unknown): readonly [string, string] {
  const { kind, fields } = safeObject(source);
  if (typeof kind !== "string" || !Object.hasOwn(shareTitles, kind)) {
    return ["分享记录", "Shared record"];
  }
  const category = kind as keyof typeof shareTitles;
  const values = new Map(
    Array.isArray(fields) ? fields.map((entry) => {
      const { key, value } = safeObject(entry);
      return [key, value];
    }) : [],
  );
  const sport = values.get("sportName");
  if (category === "workout" && typeof sport === "string" && sport.trim()) {
    return [sport, sport];
  }
  if (category === "health") {
    const key = shareFieldPriority.health.find((candidate) => values.has(candidate));
    if (key === "systolic" || key === "diastolic") return ["血压记录", "Blood pressure record"];
    if (key) {
      const [zh, en] = shareFieldNames[key];
      return [zh + "记录", en + " record"];
    }
  }
  return shareTitles[category];
}
