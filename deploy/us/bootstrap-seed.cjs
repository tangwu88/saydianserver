// Fresh US database only. Credentials stay in the host's private environment.
const {createRequire} = require('node:module');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const runtimeRequire = createRequire('/workspace/apps/api/package.json');
const {PrismaClient} = runtimeRequire('@prisma/client');
const {hash} = runtimeRequire('bcryptjs');
const assert = require('node:assert/strict');
const prisma = new PrismaClient();
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
(async () => {
  assert.equal(await prisma.user.count(), 0, 'Fresh bootstrap refuses existing members');
  assert.match(process.env.US_BOOTSTRAP_ADMIN_PASSWORD || '', /^[a-f0-9]{64}$/);
  const username = process.env.US_BOOTSTRAP_ADMIN_USERNAME;
  const existing = await prisma.adminUser.findUnique({where:{username}});
  if (!existing) await prisma.adminUser.create({data:{username, displayName:'SayDian US Administrator',
    passwordHash:await hash(process.env.US_BOOTSTRAP_ADMIN_PASSWORD,12), role:'SUPER_ADMIN',roles:['SUPER_ADMIN']}});
  await prisma.integrationConfig.upsert({where:{key:'object_storage'},create:{key:'object_storage',
    state:'CONFIGURED',publicConfig:{endpoint:'http://us-minio:9000',
      bucket:'saydian-us-private',region:'us-east-1',forcePathStyle:true}},update:{}});
  const manifest = JSON.parse(readFileSync('/release/deploy/us/legal/approved.json','utf8'));
  assert.equal(manifest.version,'global-appstore-2026-10-14-r3');
  assert.equal(manifest.reviewed,true);
  for (const doc of manifest.documents) {
    assert(['privacy_policy','user_agreement'].includes(doc.documentType));
    const content = readFileSync('/release/deploy/us/legal/'+doc.file,'utf8');
    assert.equal(createHash('sha256').update(content).digest('hex'),doc.sha256);
    const key={documentType:doc.documentType,version:manifest.version,locale:'en'};
    const contentHtml=content.split(/\n\s*\n/).map(p=>'<p>'+escape(p).replaceAll('\n','<br>')+'</p>').join('\n');
    const current=await prisma.globalLegalDocument.findUnique({where:{documentType_version_locale:key}});
    if (current) assert.equal(current.contentHtml,contentHtml,'Approved legal text changed');
    else await prisma.globalLegalDocument.create({data:{...key,title:doc.title,contentHtml,reviewed:true,active:true,publishedAt:new Date()}});
  }
  console.log('Fresh US administrator and exact reviewed English legal pair initialized');
})().catch(()=>{console.error('US initialization failed; private diagnostic remains on host');process.exitCode=1;}).finally(()=>prisma.$disconnect());
