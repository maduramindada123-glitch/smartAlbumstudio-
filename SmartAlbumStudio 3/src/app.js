const state = {
  photos: [],
  filter: 'all',
  sortAscending: true,
  importing: false,
  mode: 'simple'
};

const $ = (id) => document.getElementById(id);
const photoGrid = $('photo-grid');

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('toast-region').append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function renderPhotos() {
  photoGrid.replaceChildren();
  const photos = state.photos
    .filter((photo) => state.filter === 'all' || !photo.used)
    .sort((a, b) => state.sortAscending
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name));

  if (!photos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-library';
    empty.innerHTML = '<div class="empty-icon">▧</div><strong>No photos to show</strong><p>Import photos or choose another library filter.</p>';
    photoGrid.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const photo of photos) {
      const card = document.createElement('div');
      card.className = 'photo-card';
      card.title = `${photo.name}\n${photo.width} × ${photo.height}`;
      const image = document.createElement('img');
      image.src = photo.thumbnailUrl;
      image.alt = photo.name;
      image.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'photo-name';
      name.textContent = photo.name;
      card.append(image, name);
      fragment.append(card);
    }
    photoGrid.append(fragment);
  }

  $('photo-count').textContent = String(state.photos.length);
  $('empty-state')?.remove();
  $('export-button').disabled = state.photos.length === 0;
  $('library-status').textContent = state.photos.length
    ? `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'} ready`
    : 'Ready to import';
}

function setProgress(completed, total) {
  $('progress-panel').classList.toggle('hidden', total === 0 || completed >= total);
  $('progress-text').textContent = `${completed} / ${total}`;
  $('progress-fill').style.width = `${total ? (completed / total) * 100 : 0}%`;
}

async function runImport(kind) {
  if (state.importing) {
    toast('An import is already running. Please wait for it to finish.', 'error');
    return;
  }
  state.importing = true;
  try {
    const result = kind === 'folder'
      ? await window.smartAlbum.chooseFolder()
      : await window.smartAlbum.chooseFiles();
    if (result?.canceled) return;
    if (result?.total === 0) toast('No supported photos were found in that selection.', 'error');
  } catch (error) {
    toast(`Import could not start: ${error.message}`, 'error');
  } finally {
    state.importing = false;
  }
}

$('import-folder').addEventListener('click', () => runImport('folder'));
$('import-files').addEventListener('click', () => runImport('files'));
$('welcome-import').addEventListener('click', () => runImport('folder'));

$('theme-select').addEventListener('change', (event) => {
  document.body.dataset.theme = event.target.value;
  localStorage.setItem('smartAlbumTheme', event.target.value);
});

document.querySelectorAll('.filter-tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    state.filter = button.dataset.filter;
    renderPhotos();
  });
});

$('sort-button').addEventListener('click', () => {
  state.sortAscending = !state.sortAscending;
  $('sort-button').title = state.sortAscending ? 'Sort A to Z' : 'Sort Z to A';
  renderPhotos();
});

function setMode(mode) {
  state.mode = mode;
  $('simple-mode').classList.toggle('active', mode === 'simple');
  $('advanced-mode').classList.toggle('active', mode === 'advanced');
  if (mode === 'advanced') toast('Advanced editing tools arrive in Stage 3.', 'success');
}
$('simple-mode').addEventListener('click', () => setMode('simple'));
$('advanced-mode').addEventListener('click', () => setMode('advanced'));

const helpDialog = $('help-dialog');
$('help-button').addEventListener('click', () => helpDialog.showModal());
$('close-help').addEventListener('click', () => helpDialog.close());
$('done-help').addEventListener('click', () => helpDialog.close());

window.smartAlbum.onImportStarted(({ total }) => {
  if (total > 0) {
    $('progress-panel').classList.remove('hidden');
    setProgress(0, total);
  }
});
window.smartAlbum.onPhoto((photo) => {
  state.photos.push(photo);
  renderPhotos();
});
window.smartAlbum.onImportProgress(({ completed, total }) => setProgress(completed, total));
window.smartAlbum.onImportError(({ file, message }) => {
  toast(`${file.split(/[\\/]/).pop()}: ${message}`, 'error');
});
window.smartAlbum.onImportFinished(({ total }) => {
  state.importing = false;
  $('progress-panel').classList.add('hidden');
  if (total > 0) toast(`Import complete. ${state.photos.length} photos are ready.`, 'success');
  else toast('No photos were imported.', 'error');
});

const savedTheme = localStorage.getItem('smartAlbumTheme');
if (['black', 'white', 'red', 'blue'].includes(savedTheme)) {
  document.body.dataset.theme = savedTheme;
  $('theme-select').value = savedTheme;
}

window.smartAlbum.getSystemTheme().then((theme) => {
  if (!savedTheme && theme === 'light') {
    document.body.dataset.theme = 'white';
    $('theme-select').value = 'white';
  }
}).catch(() => {});

renderPhotos();
