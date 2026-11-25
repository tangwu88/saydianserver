import { describe,expect,it } from "vitest";
import { parseSyncReadEvidence } from "./sync-read-evidence";
const sample = () => ({metrics:[{metric:"heart_rate",state:"partial",mappingObserved:true,requests:1,packets:2,wireRows:3,decodedRows:3,mappedRecords:1,filteredRecords:2}],clock:{format:"confirmed",submission:"attempted",verification:"not_observed"},monitoring:{heartRate:true}});
describe("first read counts privacy boundary",()=>{
  it("retains exact counters without treating a send attempt as clock verification",()=>expect(parseSyncReadEvidence(sample())).toEqual(sample()));
  it.each(["address","deviceId","value","timestamp","rawPacket","token"])("rejects extra root field %s",key=>expect(()=>parseSyncReadEvidence({...sample(),[key]:"private"})).toThrow());
  it.each([-1,1.5,1000001,"2",null,Infinity])("rejects invalid counters %s",n=>{const x:any=sample();x.metrics[0].packets=n;expect(()=>parseSyncReadEvidence(x)).toThrow();});
  it("rejects duplicate metric rows",()=>{const x=sample();x.metrics.push(x.metrics[0]!);expect(()=>parseSyncReadEvidence(x)).toThrow();});
  it("rejects decoded readings even inside a valid row",()=>{const x:any=sample();x.metrics[0].value=72;expect(()=>parseSyncReadEvidence(x)).toThrow();});
  it("cannot turn an SDK send into a verified readback",()=>{const x:any=sample();x.clock.verification="verified";expect(()=>parseSyncReadEvidence(x)).toThrow();});
  it("keeps absent monitoring unknown instead of false",()=>{const {monitoring,...x}=sample();expect(parseSyncReadEvidence(x).monitoring).toBeUndefined();});
});
