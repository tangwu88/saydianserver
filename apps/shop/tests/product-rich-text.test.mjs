import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), ts=require('typescript');
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/product-rich-text.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
const {responsiveProductHtml}=module.exports;
test('native product rich text overrides oversized inline dimensions and keeps image content',()=>{
 const result=responsiveProductHtml('<p>详情</p><IMG width="1600" height=3000 style="width:1600px;height:3000px" src="https://example.com/a.png" alt="说明 > 图"><img src=\'https://example.com/b.png\'/>');
 assert.ok(result.startsWith('<p>详情</p>'));
 assert.match(result,/src="https:\/\/example.com\/a.png" alt="说明 > 图"/);
 assert.match(result,/src='https:\/\/example.com\/b.png'/);
 assert.equal((result.match(/style="display:block;width:100%;max-width:100%;height:auto;/g)||[]).length,2);
 assert.doesNotMatch(result,/1600|3000|width="|height=/);
});
test('text-only and absent product details remain usable',()=>{
 assert.equal(responsiveProductHtml('<p>商品描述</p>'),'<p>商品描述</p>');
 assert.equal(responsiveProductHtml(null),'');
});
