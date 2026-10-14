const status = document.querySelector('#release-status');
try {
  const response = await fetch('/global/api/saydian-app/v2/support/app-update?product=saydian-global', {
    cache: 'no-store', headers: {Accept: 'application/json'},
  });
  const envelope = await response.json();
  if (!response.ok || envelope.code !== 200) throw new Error('Release information is temporarily unavailable.');
  const data = envelope.data?.value ?? envelope.data;
  if (data?.realm !== 'global' || !Array.isArray(data.releases)) throw new Error('Release information is not available yet.');
  for (const platform of ['android', 'ios']) {
    const card = document.querySelector(`[data-platform="${platform}"]`);
    const release = data.releases.find(item => item.platform === platform);
    if (!release || release.packageId !== 'cn.saydian.app.global') continue;
    if (typeof release.versionName === 'string' && Number.isSafeInteger(release.buildNumber)) {
      card.querySelector('[data-version]').textContent = `${release.versionName} (${release.buildNumber})`;
    }
    if (release.status === 'coming_soon' || !release.destination) {
      card.querySelector('[data-status]').textContent = release.pendingReason === 'review'
        ? 'Awaiting review. Installation will open after approval.' : 'Installation is not available yet.';
      continue;
    }
    const destination = release.destination;
    const url = new URL(destination.url, location.origin);
    const allowed = url.protocol === 'https:' && !url.username && !url.password && (
      destination.kind === 'direct' && url.origin === location.origin && url.pathname.startsWith('/global/down/files/') ||
      ['market', 'testflight'].includes(destination.kind) && ['apps.apple.com', 'testflight.apple.com', 'play.google.com'].includes(url.hostname)
    );
    if (!allowed) continue;
    const link = card.querySelector('[data-install]');
    link.href = url.href; link.hidden = false;
    card.querySelector('[data-status]').textContent = destination.kind === 'testflight'
      ? 'Install with TestFlight.' : destination.kind === 'market' ? 'Install from the official app store.' : 'Download the published installation package.';
  }
  status.hidden = true;
} catch {
  status.textContent = 'Release information is not available yet. Please check back later.';
}
