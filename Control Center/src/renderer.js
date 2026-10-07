const bridge = window.controlCenter;
const byId = id => document.getElementById(id);
const headings = {
  recovery: ['Backup & recovery', 'Institution-owned encrypted recovery for a replacement computer.'],
  overview: ['Overview', 'Prepare Tomeva for a new institution Firebase project.'],
  setup: ['Firebase setup', 'Enter project details, copy the complete rules, and export.'],
  packages: ['Setup packages', 'Prepare configuration for the Librarian and Admin desktop apps.'],
  web: ['Student web code', 'Export and check the institution’s student site.'],
  updates: ['Software updates', 'Review public Tomeva releases.'],
};
let config = null;
const cleanError = value => String(value?.message || value).replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]+Error:\s*)?/, '');
function notice(message, kind = '') {
  const el = byId('notice'); el.textContent = cleanError(message); el.className = 'notice ' + kind;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => el.classList.add('hidden'), 10000);
}
function navigate(page) {
  if (!headings[page]) return;
  document.querySelectorAll('.page').forEach(item => item.classList.toggle('active', item.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  byId('page-title').textContent = headings[page][0]; byId('page-description').textContent = headings[page][1];
}
document.querySelectorAll('[data-page]').forEach(item => item.addEventListener('click', () => navigate(item.dataset.page)));
document.querySelectorAll('[data-go]').forEach(item => item.addEventListener('click', () => navigate(item.dataset.go)));
bridge.onNavigate(navigate);
document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportPackages(button.dataset.export)));

function formValue() {
  const form = byId('config-form').elements;
  const institutionName = form.namedItem('institutionName').value.trim();
  if (!institutionName) throw new Error('Enter the institution name in Firebase setup.');
  return {
    institutionName,
    firebase: Object.fromEntries(['projectId', 'apiKey', 'authDomain', 'appId', 'messagingSenderId', 'storageBucket', 'databaseURL', 'measurementId'].map(key => [key, form.namedItem(key).value.trim()])),
    staffDomain: form.namedItem('staffDomain').value.trim(), webUrl: form.namedItem('webUrl').value.trim(),
  };
}
function fillForm(value) {
  if (!value) return;
  const form = byId('config-form').elements;
  for (const [key, valueText] of Object.entries({ ...value.firebase, institutionName: value.institutionName, staffDomain: value.staffDomain, webUrl: value.webUrl })) {
    const field = form.namedItem(key); if (field) field.value = valueText || '';
  }
}
function showConfig() {
  const project = config?.firebase.projectId;
  byId('sidebar-institution').textContent = config?.institutionName || project || 'No project entered';
  byId('overview-setup').textContent = project ? 'Project settings saved' : 'Waiting for project details';
  byId('overview-setup-detail').textContent = project ? `Ready to generate setup packages for ${project}.` : 'A new Firebase project starts empty. Control Center supplies the rules and app configuration.';
  byId('deploy-project').textContent = project || 'YOUR_PROJECT';
  byId('config-saved').textContent = project ? `Saved locally for ${project}` : '';
}
byId('config-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { config = await bridge.saveConfig(formValue()); showConfig(); await showRecovery(); navigate('recovery'); notice('Project settings saved. Create or update your Recovery Kit.', 'success'); }
  catch (error) { notice(error.message, 'error'); }
});
async function exportPackages(component = 'all') {
  try { const result = await bridge.exportSetup(formValue(), component, byId('package-platform').value); if (!result.cancelled) notice(`Verified release ${result.version} and institution configuration saved to ${result.path}`, 'success'); }
  catch (error) { navigate('setup'); notice(error.message, 'error'); }
}
byId('export-setup').addEventListener('click', () => exportPackages());
byId('export-packages').addEventListener('click', () => exportPackages());
byId('copy-rules').addEventListener('click', async () => {
  try { const value = formValue(); await bridge.copyRules(value); notice(`Rules for ${value.firebase.projectId} (${value.staffDomain.toLowerCase()}) copied. Paste into that project's Firestore Database → Rules, test, then Publish.`, 'success'); }
  catch (error) { notice(error.message, 'error'); }
});
byId('preview-rules').addEventListener('click', async () => {
  try { byId('rules-preview').textContent = await bridge.getRules(formValue()); byId('rules-preview').classList.remove('hidden'); }
  catch (error) { notice(error.message, 'error'); }
});
byId('config-form').addEventListener('input', () => {
  byId('rules-preview').textContent = '';
  byId('rules-preview').classList.add('hidden');
});
byId('export-web').addEventListener('click', async () => {
  try { const result = await bridge.exportWeb(formValue()); if (!result.cancelled) notice(`Student web code exported to ${result.path}`, 'success'); }
  catch (error) { navigate('setup'); notice(error.message, 'error'); }
});
byId('check-web').addEventListener('click', async () => {
  try {
    const value = formValue();
    const projectId = value.firebase.projectId;
    if (!value.webUrl && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Enter a valid Firebase project ID or Student web URL in Firebase setup.');
    const result = await bridge.checkWeb(value.webUrl || `https://${projectId}.web.app/`);
    byId('web-check-result').textContent = result.updateAvailable ? `Deployed ${result.deployedVersion}; package ${result.availableVersion} is available here.` : `Deployed version ${result.deployedVersion} is current.`;
  } catch (error) { byId('web-check-result').textContent = cleanError(error); }
});
async function showDesktopReleases() {
  const releases = await bridge.updates.desktopReleases();
  for (const component of ['librarian', 'admin']) {
    const release = releases[component];
    byId(`${component}-release`).textContent = release?.state === 'current-release' ? `Latest public release: ${release.version}` : release?.state === 'unconfigured' ? 'Public release repository is not configured in this build.' : `Release check failed: ${release?.message || 'Unknown error'}`;
  }
}
byId('update-check').addEventListener('click', () => { bridge.updates.check(); showDesktopReleases().catch(error => notice(error.message, 'error')); });
byId('update-download').addEventListener('click', () => bridge.updates.download());
byId('update-install').addEventListener('click', () => bridge.updates.install());
document.querySelectorAll('[data-desktop-update]').forEach(button => button.addEventListener('click', () => {
  bridge.updates.openDesktop(button.dataset.desktopUpdate).catch(error => notice('Could not open the installed updater: ' + error.message, 'error'));
}));
function showUpdateStatus(status) {
  const labels = { development: 'Development build', checking: 'Checking public releases', current: 'Up to date', available: `Version ${status.availableVersion} available`, downloading: 'Downloading update', ready: 'Ready to install', error: 'Update check needs attention', unconfigured: 'Release channel not configured' };
  byId('update-heading').textContent = labels[status.state] || status.state;
  byId('update-status').textContent = status.message || ({ available: 'Review the notes, then download when ready.', ready: 'Restart to install the downloaded version.', development: 'Update checks are available in installed builds.', unconfigured: 'The release owner and repository must be configured when building the installer.' }[status.state] || '');
  byId('update-version').textContent = `Installed version ${status.version || '—'}`;
  byId('update-notes').textContent = releaseText(Array.isArray(status.releaseNotes) ? status.releaseNotes.map(item => item.note || '').join('\n') : status.releaseNotes);
  byId('update-download').disabled = status.state !== 'available'; byId('update-install').disabled = status.state !== 'ready';
  byId('update-progress').classList.toggle('hidden', status.state !== 'downloading'); byId('update-progress').value = Number(status.percent) || 0;
}
function releaseText(value) {
  const source = String(value || '').replace(/<\/(?:p|div|li|h[1-6]|ul|ol)>/gi, '$&\n').replace(/<br\s*\/?\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
  return (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
bridge.updates.onStatus(showUpdateStatus);
(async () => {
  try {
    config = await bridge.getConfig(); fillForm(config); showConfig();
    byId('web-package-version').textContent = 'Latest GitHub release';
    showUpdateStatus(await bridge.updates.getStatus());
    showDesktopReleases().catch(error => notice(error.message, 'error'));
    await showRecovery();
    if (!config) navigate('overview');
  } catch (error) { notice('Could not load setup: ' + error.message, 'error'); }
})();

async function showRecovery() {
  const status = await bridge.recoveryStatus();
  byId('recovery-status').textContent = !status.exists ? 'Create a Recovery Kit to protect your setup' : status.stale ? 'Your Recovery Kit should be updated' : 'Recovery Kit is current';
  byId('overview-recovery').textContent = byId('recovery-status').textContent;
  byId('recovery-detail').textContent = status.exists ? `Created ${new Date(status.createdAt).toLocaleString()} · Format ${status.formatVersion}` : 'Save project settings, then create an encrypted kit.';
}
document.querySelectorAll('[data-recovery]').forEach(button => button.addEventListener('click', async () => {
  const action = button.dataset.recovery;
  const password = byId('recovery-password').value;
  if (action === 'create' && password !== byId('recovery-confirm').value) { notice('Recovery passwords do not match.', 'error'); return; }
  const buttons = document.querySelectorAll('[data-recovery]');
  buttons.forEach(item => { item.disabled = true; });
  try {
    const result = await bridge.recoveryRun(action, password);
    if (!result.cancelled) {
      if (action === 'restore') { config = await bridge.getConfig(); fillForm(config); showConfig(); }
      await showRecovery();
      notice(result.valid ? `Recovery Kit valid: integrity, encryption, institution settings and format verified for ${result.projectId}.${action === 'restore' ? ' Local setup restored.' : ' Current setup was not changed.'}` : `Encrypted Recovery Kit saved to ${result.path}`, 'success');
    }
  } catch (error) { notice(error.message, 'error'); }
  finally { byId('recovery-password').value = ''; byId('recovery-confirm').value = ''; buttons.forEach(item => { item.disabled = false; }); }
}));

document.querySelectorAll('[data-install]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const result = await bridge.installPackage(formValue(), button.dataset.install);
    if (!result.cancelled) notice('Installer opened with your institution configuration. Follow its installation prompts.', 'success');
  } catch (error) { notice(error.message, 'error'); }
  finally { button.disabled = false; }
}));

bridge.onDistributionProgress(status => {
  byId('distribution-status').classList.toggle('hidden', status.state === 'idle');
  byId('distribution-detail').textContent = `${status.name || ''} · ${status.state}${status.percent === undefined ? '' : ' ' + status.percent + '%'}`;
});
byId('cancel-distribution').addEventListener('click', () => bridge.cancelDistribution());
