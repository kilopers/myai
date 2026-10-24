import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Store } from '@tauri-apps/plugin-store';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

interface Capture {
  png_base64: string;
  width: number;
  height: number;
  scale_factor: number;
}

type Tool = 'arrow' | 'rect' | 'text' | 'blur';

interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

type Shape =
  | { kind: 'rect'; rect: Rect; color: string }
  | { kind: 'arrow'; from: Point; to: Point; color: string }
  | { kind: 'text'; at: Point; text: string; color: string }
  | { kind: 'blur'; rect: Rect };

const STORE_KEYS = { serverUrl: 'server_url', apiToken: 'api_token' } as const;
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#1c1c1e'];

// Material Design icons (24px paths)
const ICONS: Record<string, string> = {
  arrow: 'M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5H9z',
  rect: 'M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
  text: 'M5 4v3h5.5v12h3V7H19V4H5z',
  blur: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z',
};

const svgIcon = (name: string) =>
  `<svg viewBox="0 0 24 24"><path d="${ICONS[name]}"/></svg>`;

const norm = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});

function drawArrow(c: CanvasRenderingContext2D, from: Point, to: Point, color: string) {
  const head = 22;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 6;
  c.beginPath();
  c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
  c.beginPath();
  c.moveTo(to.x, to.y);
  c.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
  c.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
  c.closePath(); c.fill();
}

function drawShapes(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  shapes: Shape[],
  draft: Shape | null,
) {
  for (const s of [...shapes, ...(draft ? [draft] : [])]) {
    switch (s.kind) {
      case 'rect':
        ctx.strokeStyle = s.color; ctx.lineWidth = 5;
        ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
        break;
      case 'arrow':
        drawArrow(ctx, s.from, s.to, s.color);
        break;
      case 'text':
        ctx.fillStyle = s.color; ctx.font = 'bold 28px system-ui';
        ctx.fillText(s.text, s.at.x, s.at.y);
        break;
      case 'blur': {
        const { x, y, w, h } = s.rect;
        if (w < 2 || h < 2) break;
        const off = document.createElement('canvas');
        const factor = 0.05;
        off.width = Math.max(1, w * factor); off.height = Math.max(1, h * factor);
        const oc = off.getContext('2d')!;
        oc.drawImage(img, x, y, w, h, 0, 0, off.width, off.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, off.width, off.height, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
    }
  }
}

async function loadImage(capture: Capture): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/png;base64,${capture.png_base64}`;
  await img.decode();
  return img;
}

async function uploadPng(base64: string): Promise<string | null> {
  const store = await Store.load('settings.json');
  const serverUrl = await store.get<string>(STORE_KEYS.serverUrl);
  const token = await store.get<string>(STORE_KEYS.apiToken);
  if (!serverUrl || !token) {
    alert('Не настроен сервер или токен. Открой настройки из трея.');
    return null;
  }
  try {
    const url = await invoke<string>('upload_screenshot', {
      serverUrl, token, pngBase64: base64,
    });
    await writeText(url);
    if (!(await isPermissionGranted())) await requestPermission();
    await sendNotification({ title: 'Screenshoter', body: 'Ссылка скопирована в буфер обмена' });
    return url;
  } catch (err) {
    alert(`Ошибка загрузки: ${err}`);
    return null;
  }
}

// ---------- settings view ----------
async function initSettings() {
  const view = document.getElementById('settings-view')!;
  view.style.display = 'block';
  const canvas = document.getElementById('canvas')!;
  canvas.style.display = 'none';

  const store = await Store.load('settings.json');
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  const tokenInput = document.getElementById('api-token') as HTMLInputElement;
  const autostartInput = document.getElementById('autostart') as HTMLInputElement;
  const status = document.getElementById('settings-status')!;

  urlInput.value = (await store.get<string>(STORE_KEYS.serverUrl)) ?? '';
  tokenInput.value = (await store.get<string>(STORE_KEYS.apiToken)) ?? '';
  autostartInput.checked = await isAutostartEnabled();

  document.getElementById('save-settings')!.addEventListener('click', async () => {
    await store.set(STORE_KEYS.serverUrl, urlInput.value.trim().replace(/\/+$/, ''));
    await store.set(STORE_KEYS.apiToken, tokenInput.value.trim());
    await store.save();
    try {
      if (autostartInput.checked) await enableAutostart();
      else await disableAutostart();
    } catch (e) {
      status.textContent = `Настройки сохранены, автозапуск: ${e}`;
      return;
    }
    status.textContent = 'Сохранено.';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
}

// ---------- overlay: только выделение области ----------
async function initOverlay() {
  const win = getCurrentWindow();
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  const monIndex = Number(win.label.split('-')[1] ?? 0);
  const capture = await invoke<Capture | null>('take_capture', { index: monIndex });
  if (!capture) {
    await win.hide();
    return;
  }
  const img = await loadImage(capture);

  // Canvas в физических пикселях, растянут на всё окно-оверлей.
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';

  let dragStart: Point | null = null;
  let selection: Rect | null = null;
  let sent = false;

  const toImageCoords = (e: MouseEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  };

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Затемнение за пределами выделения
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    if (selection) {
      const { x, y, w, h } = selection;
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.strokeStyle = '#1a73e8'; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Подпись размера под выделением
      const label = `${Math.round(w)}×${Math.round(h)}`;
      ctx.font = 'bold 18px system-ui';
      const tw = ctx.measureText(label).width + 16;
      const lx = Math.min(x + w - tw, canvas.width - tw - 4);
      const ly = Math.min(y + h + 6, canvas.height - 32);
      ctx.fillStyle = '#1a73e8';
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx + 8, ly + 19);
    } else {
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    dragStart = toImageCoords(e);
    selection = null;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragStart || sent) return;
    selection = norm(dragStart, toImageCoords(e));
    render();
  });

  canvas.addEventListener('mouseup', async () => {
    if (!dragStart || sent) return;
    dragStart = null;
    if (!selection || selection.w <= 4 || selection.h <= 4) {
      selection = null;
      render();
      return;
    }
    sent = true;

    // Кроп выделенной области → окно редактора, экран «размораживается».
    const out = document.createElement('canvas');
    out.width = Math.round(selection.w);
    out.height = Math.round(selection.h);
    out.getContext('2d')!.drawImage(
      img,
      selection.x, selection.y, selection.w, selection.h,
      0, 0, out.width, out.height,
    );
    const base64 = out.toDataURL('image/png').split(',')[1];
    await invoke('open_editor', {
      pngBase64: base64,
      width: out.width,
      height: out.height,
    });
  });

  window.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') await invoke('close_overlays');
  });

  render();
}

// ---------- editor window: аннотации + отправка ----------
async function initEditor() {
  document.documentElement.style.background = '#f5f5f7';
  document.body.style.background = '#f5f5f7';
  document.body.style.overflow = 'auto';

  const toolbar = document.getElementById('toolbar')!;
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  const capture = await invoke<Capture | null>('take_edit');
  if (!capture) {
    await invoke('hide_editor');
    return;
  }
  const img = await loadImage(capture);

  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.maxWidth = 'calc(100vw - 24px)';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';
  canvas.style.margin = '52px auto 8px';
  canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.25)';
  canvas.style.background = '#fff';

  let tool: Tool = 'arrow'; // по умолчанию — стрелка
  let color = COLORS[0];
  const shapes: Shape[] = [];
  let draft: Shape | null = null;
  let dragStart: Point | null = null;
  let textInput: HTMLInputElement | null = null;

  const toImageCoords = (e: MouseEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  };

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    drawShapes(ctx, img, shapes, draft);
  }

  const tools: { id: string; icon: string; title: string; cls?: string; text?: string }[] = [
    { id: 'arrow', icon: 'arrow', title: 'Стрелка' },
    { id: 'rect', icon: 'rect', title: 'Рамка' },
    { id: 'text', icon: 'text', title: 'Текст' },
    { id: 'blur', icon: 'blur', title: 'Блюр' },
    { id: 'undo', icon: 'undo', title: 'Отменить (Ctrl+Z)' },
    { id: 'colors', icon: '', title: '' },
    { id: 'sep', icon: '', title: '' },
    { id: 'upload', icon: 'send', title: 'Загрузить и скопировать ссылку', cls: 'primary', text: 'Отправить' },
    { id: 'spacer', icon: '', title: '' },
    { id: 'close', icon: 'close', title: 'Закрыть (Esc)' },
  ];

  toolbar.innerHTML = '';
  for (const t of tools) {
    if (t.id === 'colors') {
      for (const c of COLORS) {
        const sw = document.createElement('button');
        sw.className = 'swatch';
        sw.style.background = c;
        sw.dataset.color = c;
        sw.title = 'Цвет';
        sw.addEventListener('click', () => {
          color = c;
          markSwatches();
        });
        toolbar.appendChild(sw);
      }
      continue;
    }
    if (t.id === 'sep' || t.id === 'spacer') {
      const el = document.createElement('div');
      el.className = t.id;
      toolbar.appendChild(el);
      continue;
    }
    const b = document.createElement('button');
    b.innerHTML = svgIcon(t.icon) + (t.text ? `<span>${t.text}</span>` : '');
    b.title = t.title;
    if (t.cls) b.className = t.cls;
    b.addEventListener('click', () => onToolClick(t.id));
    toolbar.appendChild(b);
  }
  toolbar.style.display = 'flex';

  function markSwatches() {
    toolbar.querySelectorAll<HTMLButtonElement>('.swatch').forEach((el) => {
      el.classList.toggle('active', el.dataset.color === color);
    });
  }

  function closeTextInput() {
    textInput?.remove();
    textInput = null;
  }

  function openTextInput(p: Point) {
    closeTextInput();
    const r = canvas.getBoundingClientRect();
    const sx = r.width / canvas.width;
    const sy = r.height / canvas.height;
    const input = document.createElement('input');
    input.id = 'text-input';
    input.placeholder = 'Введите текст';
    input.style.left = `${r.left + p.x * sx}px`;
    input.style.top = `${r.top + p.y * sy - 20}px`;
    document.body.appendChild(input);
    textInput = input;
    input.focus();
    const commit = () => {
      const t = input.value.trim();
      if (t) {
        shapes.push({ kind: 'text', at: p, text: t, color });
        render();
      }
      closeTextInput();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') closeTextInput();
    });
    input.addEventListener('blur', commit);
  }

  function markActive() {
    [...toolbar.children].forEach((el, i) => {
      el.classList.toggle('active', tools[i].id === tool);
    });
  }

  async function onToolClick(id: string) {
    if (id === 'undo') { shapes.pop(); render(); return; }
    if (id === 'close') { await invoke('hide_editor'); return; }
    if (id === 'upload') { await doUpload(); return; }
    tool = id as Tool;
    markActive();
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = toImageCoords(e);
    if (tool === 'text') {
      openTextInput(p);
      return;
    }
    closeTextInput();
    dragStart = p;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const p = toImageCoords(e);
    if (tool === 'rect') {
      draft = { kind: 'rect', rect: norm(dragStart, p), color };
    } else if (tool === 'blur') {
      draft = { kind: 'blur', rect: norm(dragStart, p) };
    } else if (tool === 'arrow') {
      draft = { kind: 'arrow', from: dragStart, to: p, color };
    }
    render();
  });

  canvas.addEventListener('mouseup', () => {
    if (!dragStart) return;
    dragStart = null;
    if (draft) {
      shapes.push(draft);
      draft = null;
    }
    render();
  });

  window.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') await invoke('hide_editor');
    if (e.ctrlKey && e.key === 'z') { shapes.pop(); render(); }
  });

  async function doUpload() {
    render();
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    const url = await uploadPng(base64);
    if (url) await invoke('hide_editor');
  }

  markActive();
  markSwatches();
  render();
}

// ---------- entry ----------
if (location.hash === '#settings' || location.search.includes('view=settings')) {
  initSettings();
} else if (location.hash === '#editor') {
  initEditor();
} else {
  initOverlay();
}
