import { describe,expect,it } from "vitest";
import { diagnosticReadRows,diagnosticClock,diagnosticMonitoring } from "./sync-diagnostic-display";
describe("first read evidence display",()=>{
  it("keeps unobserved decode counts unknown",()=>{
    const rows=diagnosticReadRows({metrics:[{metric:"heart_rate",state:"not_received",mappingObserved:false,requests:1,packets:0,wireRows:0,decodedRows:0,mappedRecords:0,filteredRecords:0}]});
    expect(rows[0]).toMatchObject({name:"心率",result:"尚无完成确认",packets:0,decoded:"未观察",filtered:"未观察"});
  });
  it("shows actual filtering separately from absent packets",()=>{
    expect(diagnosticReadRows({metrics:[{metric:"blood_oxygen",state:"complete",mappingObserved:true,decodedRows:3,mappedRecords:1,filteredRecords:2}]} )[0]).toMatchObject({name:"血氧",decoded:3,mapped:1,filtered:2});
  });
  it("does not claim SDK submission is a clock ACK",()=>expect(diagnosticClock({clock:{format:"confirmed",submission:"attempted",verification:"not_observed"}})).toContain("发送不代表完成"));
  it("does not turn missing monitoring settings into disabled",()=>{
    expect(diagnosticMonitoring({})).toBe("心率：未读取；血氧：未读取");
    expect(diagnosticMonitoring({monitoring:{heartRate:false,bloodOxygen:true}})).toBe("心率：关闭；血氧：开启");
  });
});
